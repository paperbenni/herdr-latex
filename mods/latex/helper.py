#!/usr/bin/env python3
"""Local supervisor for Herdr's LaTeX panel. No third-party Python dependencies."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent / '.runtime'
INTERVAL = 3
MAX_PDF = 250 * 1024 * 1024
CHUNK_SIZE = 4 * 1024 * 1024  # hc exec allows at most 8 MiB stdout per request.
VERSION = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:16]

# Runs on the selected machine. Paths are data, never interpolated into shell code.
REMOTE = r'''
import collections, itertools, json, os, pathlib, re, shutil, subprocess, sys, time
action, cfg = sys.argv[1], json.loads(sys.argv[2])
folder = pathlib.Path(cfg['folder']).expanduser().resolve()
tex = pathlib.Path(cfg.get('tex') or 'main.tex').expanduser()
tex = tex if tex.is_absolute() else folder / tex
pdf = pathlib.Path(cfg['pdf']).expanduser() if cfg.get('pdf') else tex.with_suffix('.pdf')
pdf = pdf if pdf.is_absolute() else folder / pdf
def stamp():
    if not pdf.is_file(): sys.exit('PDF not found: ' + str(pdf) + '. Compile first, or set the PDF output path.')
    s = pdf.stat()
    return [s.st_mtime_ns, s.st_size, s.st_ino]
if action == 'discover':
    if not folder.is_dir(): sys.exit('Project folder does not exist: ' + str(folder))
    result, seen, errors = [], set(), []
    pending = collections.deque([folder])
    started = time.monotonic()
    reason = ''
    needle = cfg.get('search', '').casefold()
    git_files = None
    if shutil.which('git'):
        try:
            probe = subprocess.run(['git', '-C', str(folder), 'rev-parse', '--is-inside-work-tree'], capture_output=True, timeout=1)
            if probe.returncode == 0 and probe.stdout.strip() == b'true':
                patterns = ['*.' + ''.join(ext) for ext in itertools.product('tT', 'eE', 'xX')]
                found = subprocess.run(['git', '-C', str(folder), 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', *patterns], capture_output=True, timeout=2)
                if found.returncode == 0:
                    git_files = [folder / os.fsdecode(p) for p in found.stdout.split(b'\0') if p]
        except subprocess.TimeoutExpired:
            pass
    def add_file(path):
        relative = str(path.relative_to(folder))
        if needle and needle not in relative.casefold(): return
        try:
            with path.open(errors='replace') as f: head = f.read(16384)
            main = bool(re.search(r'(?m)^[ \t]*\\documentclass\b', head))
        except OSError as e:
            errors.append(str(e)); return
        result.append({'path': relative, 'main': main})
    if git_files is not None:
        pending.clear()
        for path in git_files:
            if time.monotonic() - started > 3 or len(result) >= 2000:
                reason = 'Search is partial. Enter a filename filter, or cd into a narrower folder in Herdr.'
                break
            add_file(path)
    while pending:
        if len(seen) >= 10000 or time.monotonic() - started > 2:
            reason = 'Search reached its directory or time limit. Enter a filename filter, or cd into a narrower folder in Herdr.'
            break
        parent = pending.popleft()
        try:
            info = parent.stat()
            identity = (info.st_dev, info.st_ino)
            if identity in seen: continue
            seen.add(identity)
            with os.scandir(parent) as entries: entries = sorted(entries, key=lambda e: e.name.casefold())
        except OSError as e:
            errors.append(str(e)); continue
        for entry in entries:
            if time.monotonic() - started > 2:
                reason = 'Search is partial. Enter a filename filter, or cd into a narrower folder in Herdr.'
                break
            try:
                path = pathlib.Path(entry.path)
                if entry.is_dir():
                    if not entry.name.startswith('.') and entry.name not in ('node_modules', 'venv', '__pycache__', 'build', '_build', 'dist'):
                        pending.append(path)
                elif entry.name.lower().endswith('.tex') and entry.is_file():
                    add_file(path)
                    if len(result) >= 2000:
                        reason = 'Showing the first 2,000 matching TeX files. Enter a filename filter, or cd into a narrower folder in Herdr.'
                        break
            except OSError as e: errors.append(str(e))
        if reason: break
    result.sort(key=lambda f: (not f['main'], f['path'].casefold()))
    print(json.dumps({'files': result, 'folder': str(folder), 'truncated': bool(reason), 'reason': reason,
                      'directories': len(seen), 'errors': errors[:5], 'search': cfg.get('search', ''),
                      'method': 'git' if git_files is not None else 'walk'}))
elif action == 'compile':
    if not tex.is_file(): sys.exit('Main TeX file does not exist: ' + str(tex))
    if not shutil.which('latexmk'): sys.exit('latexmk is not installed or is not on PATH on this machine.')
    flag = {'pdflatex': '-pdf', 'lualatex': '-lualatex', 'xelatex': '-xelatex'}[cfg['engine']]
    sys.exit(subprocess.call(['latexmk', flag, '-cd', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-synctex=1', str(tex)], cwd=folder))
elif action == 'stat':
    print(json.dumps({'stamp': stamp(), 'path': str(pdf)}))
elif action == 'download':
    before = stamp()
    if before[1] > 250 * 1024 * 1024: sys.exit('PDF exceeds the 250 MiB preview limit.')
    if cfg.get('expected_stamp') is not None and before != cfg['expected_stamp']:
        sys.exit('PDF changed while fetching it; retrying shortly.')
    offset = int(cfg.get('offset', 0))
    length = int(cfg.get('length', 4 * 1024 * 1024))
    if offset < 0 or not 0 < length <= 4 * 1024 * 1024: sys.exit('Invalid PDF chunk range.')
    # Avoid reading while the compiler is still writing the file.
    if offset == 0: time.sleep(0.65)
    if stamp() != before: sys.exit('PDF is still being written; retrying on the next check.')
    with pdf.open('rb') as f:
        if f.read(5) != b'%PDF-': sys.exit('The output is not a PDF yet.')
        f.seek(max(0, before[1] - 2048))
        if b'%%EOF' not in f.read(): sys.exit('PDF is incomplete; waiting for the compiler to finish.')
        f.seek(offset)
        sys.stdout.buffer.write(f.read(length))
    sys.stdout.buffer.flush()
    if stamp() != before: sys.exit('PDF changed during download; keeping the previous preview.')
'''


def atomic_json(path, data):
    tmp = path.with_name(path.name + '.new-' + uuid.uuid4().hex)
    tmp.write_text(json.dumps(data))
    os.replace(tmp, path)


def load(path, fallback=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


def config(raw):
    c = json.loads(raw)
    out = {k: str(c.get(k) or '').strip() for k in ('machine', 'folder', 'tex', 'pdf', 'engine')}
    if not out['folder']:
        raise ValueError('Enter a project folder.')
    out['engine'] = out['engine'] or 'pdflatex'
    if out['engine'] not in ('pdflatex', 'lualatex', 'xelatex'):
        raise ValueError('Unknown LaTeX engine.')
    return out


def session(c):
    key = hashlib.sha256(json.dumps(c, sort_keys=True).encode()).hexdigest()[:24]
    d = ROOT / key
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    return d


def command(c, action):
    args = ['python3', '-c', REMOTE, action, json.dumps(c)]
    if not c['machine']:
        return args
    timeout = 600 if action == 'compile' else 8 if action == 'discover' else 30
    return ['hc', 'exec', '--on', c['machine'], '--timeout', str(timeout), '--', *args]


def query(c, action):
    try:
        r = subprocess.run(command(c, action), capture_output=True, text=True, timeout=12 if action == 'discover' else 35)
    except subprocess.TimeoutExpired:
        raise RuntimeError('The machine did not respond in time. Check its connection and try again.') from None
    if r.returncode:
        raise RuntimeError(r.stderr.strip()[-1800:] or f'{action} failed ({r.returncode}).')
    return json.loads(r.stdout)


def preview_dir(d):
    # The actual PDF is temporary; only status/configuration lives in the mod.
    saved = load(d / 'preview-dir.json')
    if saved:
        p = Path(saved)
        if p.is_dir() and not p.is_symlink() and p.stat().st_uid == os.getuid():
            return p
    p = Path(tempfile.mkdtemp(prefix='herdr-latex-'))
    atomic_json(d / 'preview-dir.json', str(p))
    return p


def refresh(c, d, state, force=False):
    meta = query(c, 'stat')
    dest = Path(state['preview_path'])
    if not force and meta['stamp'] == state.get('stamp') and dest.is_file():
        return
    partial = dest.with_suffix('.pdf.part')
    size = meta['stamp'][1]
    if not 8 <= size <= MAX_PDF:
        raise RuntimeError('The PDF is empty or exceeds the 250 MiB preview limit.')
    try:
        with partial.open('wb') as out:
            for offset in range(0, size, CHUNK_SIZE):
                length = min(CHUNK_SIZE, size - offset)
                request = {**c, 'offset': offset, 'length': length, 'expected_stamp': meta['stamp']}
                try:
                    r = subprocess.run(command(request, 'download'), stdout=out, stderr=subprocess.PIPE, timeout=35)
                except subprocess.TimeoutExpired:
                    raise RuntimeError('Herdr PDF transfer timed out. Keeping the previous local PDF and retrying shortly.') from None
                if r.returncode:
                    raise RuntimeError(r.stderr.decode(errors='replace').strip()[-1800:] or 'Herdr PDF transfer failed.')
                if out.tell() != offset + length:
                    raise RuntimeError('Herdr returned an incomplete PDF chunk. Keeping the previous local PDF.')
                # Large transfers may span many requests; keep activity reporting live.
                state['heartbeat'] = time.time()
                atomic_json(d / 'status.json', state)
        if partial.stat().st_size > MAX_PDF or partial.stat().st_size < 8:
            raise RuntimeError('The downloaded PDF is empty or too large.')
        after = query(c, 'stat')
        if after['stamp'] != meta['stamp']:
            raise RuntimeError('PDF changed while fetching it; retrying shortly.')
        os.replace(partial, dest)
        state.update(stamp=meta['stamp'], updated=time.time(), remote_pdf=meta['path'])
    finally:
        partial.unlink(missing_ok=True)


def open_pdf(path, d):
    opener = 'open' if sys.platform == 'darwin' else 'xdg-open'
    if not shutil.which(opener):
        raise RuntimeError(f'{opener} is not installed. Local PDF: {path}')
    # Detached from helper lifetime; errors are checked on the next worker turn.
    log = (d / 'viewer.log').open('wb')
    try:
        return subprocess.Popen([opener, path], stdout=log, stderr=log, start_new_session=True)
    finally:
        log.close()


def worker(d):
    lock = (d / 'worker.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    c = load(d / 'config.json')
    old = load(d / 'status.json', {})
    state = {k: old[k] for k in ('preview_path', 'updated', 'stamp', 'remote_pdf', 'build_code', 'build_log') if k in old}
    state.update(pid=os.getpid(), worker_version=VERSION, watching=False, building=False, phase='Ready', error='')
    local = preview_dir(d)
    state['preview_path'] = str(local / 'preview.pdf')
    build = None
    build_out = None
    viewer = None
    last_request = time.monotonic()
    next_check = 0
    auto_open = False
    try:
        while True:
            now = time.monotonic()
            for req in sorted(d.glob('request-*.json')):
                request = load(req, {})
                req.unlink(missing_ok=True)
                action = request.get('action')
                last_request = now
                state['error'] = ''
                try:
                    if action == 'stop':
                        state.update(watching=False, phase='Preview updates stopped')
                        auto_open = False
                    elif action in ('compile', 'build-preview'):
                        if build:
                            continue
                        if not c['tex']:
                            raise RuntimeError('Choose a main .tex file first.')
                        build_out = (d / 'build.log').open('wb')
                        build = subprocess.Popen(command(c, 'compile'), stdout=build_out, stderr=subprocess.STDOUT, start_new_session=True)
                        build_started = now
                        preview_after_build = action == 'build-preview'
                        state.update(building=True, phase='Compiling…', build_log='', build_code=None)
                    elif action in ('preview', 'refresh'):
                        state.update(watching=True, phase='Fetching PDF…')
                        auto_open = action == 'preview'
                        next_check = 0
                except Exception as e:
                    state['error'] = str(e)
            if build:
                try:
                    with (d / 'build.log').open('rb') as f:
                        f.seek(max(0, f.seek(0, 2) - 18000))
                        state['build_log'] = f.read().decode(errors='replace')
                except OSError:
                    pass
                code = build.poll()
                if code is None and now - build_started > 610:
                    os.killpg(build.pid, signal.SIGTERM)
                    code = build.wait(timeout=5)
                if code is not None:
                    build_out.close()
                    build_out = None
                    build = None
                    state.update(building=False, build_code=code, phase='Build succeeded' if code == 0 else 'Build failed — see log')
                    if code == 0:
                        next_check = 0
                        if preview_after_build:
                            state['watching'] = True
                            auto_open = True
            if viewer and viewer.poll() is not None:
                if viewer.returncode:
                    state['error'] = 'Could not open the local PDF: ' + (d / 'viewer.log').read_text(errors='replace')[-1200:]
                viewer = None
            if state['watching'] and not build and now >= next_check:
                try:
                    refresh(c, d, state)
                    state['error'] = ''
                    state['phase'] = 'Preview up to date · checking every 3 seconds'
                    if auto_open:
                        viewer = open_pdf(state['preview_path'], d)
                        auto_open = False
                except Exception as e:
                    state.update(error=str(e), phase='Waiting for PDF · retrying automatically')
                next_check = time.monotonic() + INTERVAL
            state['heartbeat'] = time.time()
            atomic_json(d / 'status.json', state)
            # Keep preview running across UI reloads, bounded to twelve hours.
            if not build and now - last_request > (43200 if state['watching'] else 600):
                break
            time.sleep(0.5)
    finally:
        state.update(watching=False, building=False, pid=None, phase='Stopped')
        atomic_json(d / 'status.json', state)
        if build_out:
            build_out.close()


def main():
    os.umask(0o077)
    p = argparse.ArgumentParser()
    p.add_argument('action', choices=['compile', 'build-preview', 'preview', 'refresh', 'stop', 'status', 'discover', 'worker'])
    p.add_argument('--config')
    p.add_argument('--directory')
    p.add_argument('--search', default='')
    args = p.parse_args()
    if args.action == 'worker':
        worker(Path(args.directory))
        return
    c = config(args.config)
    d = session(c)
    if args.action == 'discover':
        print(json.dumps(query({**c, 'search': args.search}, 'discover')))
        return
    if args.action == 'status':
        print(json.dumps({'status': load(d / 'status.json', {}), 'status_file': str(d / 'status.json')}))
        return
    old = load(d / 'status.json', {})
    # Helpers survive UI reloads. Upgrade an idle helper before sending new actions.
    if old.get('pid') and old.get('worker_version') != VERSION:
        pid = old['pid']
        check = subprocess.run(['ps', '-p', str(pid), '-o', 'args='], capture_output=True, text=True)
        if str(Path(__file__).resolve()) in check.stdout and 'worker' in check.stdout:
            if old.get('building'):
                raise RuntimeError('The existing build is still running. Wait for it to finish, then try again to load the updated panel helper.')
            try:
                if os.getpgid(pid) == pid: os.killpg(pid, signal.SIGTERM)
                else: os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            with (d / 'worker.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
            if old.get('watching') and args.action == 'compile':
                atomic_json(d / f'request-{time.time_ns()}-resume.json', {'action': 'refresh'})
    atomic_json(d / 'config.json', c)
    atomic_json(d / f'request-{time.time_ns()}-{uuid.uuid4().hex}.json', {'action': args.action})
    # Duplicate starts are harmless: worker.lock admits just one supervisor.
    log = (d / 'helper.log').open('ab')
    subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'worker', '--directory', str(d)],
                     stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    log.close()
    print(json.dumps({'directory': str(d), 'status_file': str(d / 'status.json')}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
