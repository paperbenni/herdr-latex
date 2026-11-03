#!/usr/bin/env python3
"""Local supervisor for Herdr's LaTeX panel. No third-party Python dependencies."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import BinaryIO, Literal, overload

from remote import (
    Action,
    Config,
    Discovery,
    Metadata,
    Request,
    Status,
    parse_config,
    parse_discovery,
    parse_metadata,
    parse_status,
    record,
)

ROOT = Path(__file__).resolve().parent / ".runtime"
INTERVAL = 3
MAX_PDF = 250 * 1024 * 1024
CHUNK_SIZE = 4 * 1024 * 1024  # hc exec allows at most 8 MiB stdout per request.
VERSION = hashlib.sha256(
    Path(__file__).read_bytes() + Path(__file__).with_name("remote.py").read_bytes()
).hexdigest()[:16]


class StopRequested(Exception):
    pass


def cancel_process(process: subprocess.Popen[bytes] | subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=2)


def run_interruptible(
    argv: list[str], stdout: BinaryIO | int, timeout: float, directory: Path
) -> subprocess.CompletedProcess[bytes]:
    if (directory / "stop-request.json").exists():
        raise StopRequested()
    process = subprocess.Popen(argv, stdout=stdout, stderr=subprocess.PIPE, start_new_session=True)
    deadline = time.monotonic() + timeout
    try:
        while True:
            if (directory / "stop-request.json").exists():
                raise StopRequested()
            if time.monotonic() >= deadline:
                raise subprocess.TimeoutExpired(argv, timeout)
            try:
                output, error = process.communicate(timeout=0.1)
                return subprocess.CompletedProcess(argv, process.returncode, output, error)
            except subprocess.TimeoutExpired:
                pass
    finally:
        cancel_process(process)
        if process.stdout is not None:
            process.stdout.close()
        if process.stderr is not None:
            process.stderr.close()


# Runs on the selected machine. Paths are data, never interpolated into shell code.
REMOTE_PATH = Path(__file__).with_name("remote.py")
REMOTE = REMOTE_PATH.read_text()


def atomic_json(path: Path, data: object) -> None:
    tmp = path.with_name(path.name + ".new-" + uuid.uuid4().hex)
    tmp.write_text(json.dumps(data))
    os.replace(tmp, path)


def load(path: Path, fallback: object = None) -> object:
    try:
        value: object = json.loads(path.read_text())
        return value
    except (OSError, ValueError):
        return fallback


def config(raw: str) -> Config:
    value: object = json.loads(raw)
    return parse_config(value)


def session(c: Config) -> Path:
    key = hashlib.sha256(json.dumps(c, sort_keys=True).encode()).hexdigest()[:24]
    d = ROOT / key
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    return d


def command(c: Config, action: Action) -> list[str]:
    args = ["python3", "-c", REMOTE, action, json.dumps(c)]
    if not c["machine"]:
        return args
    timeout = 600 if action == "compile" else 8 if action == "discover" else 30
    return ["hc", "exec", "--on", c["machine"], "--timeout", str(timeout), "--", *args]


def request_config(c: Config) -> Request:
    return Request(
        machine=c["machine"], folder=c["folder"], tex=c["tex"], pdf=c["pdf"], engine=c["engine"]
    )


@overload
def query(c: Config, action: Literal["stat"], cancel_dir: Path | None = None) -> Metadata: ...


@overload
def query(c: Config, action: Literal["discover"], cancel_dir: Path | None = None) -> Discovery: ...


def query(
    c: Config, action: Literal["stat", "discover"], cancel_dir: Path | None = None
) -> Metadata | Discovery:
    try:
        timeout = 12 if action == "discover" else 35
        if cancel_dir is not None:
            result = run_interruptible(command(c, action), subprocess.PIPE, timeout, cancel_dir)
            stdout = result.stdout.decode(errors="replace")
            stderr = result.stderr.decode(errors="replace")
            code = result.returncode
        else:
            result_text = subprocess.run(
                command(c, action), capture_output=True, text=True, timeout=timeout, check=False
            )
            stdout, stderr, code = result_text.stdout, result_text.stderr, result_text.returncode
    except subprocess.TimeoutExpired:
        raise RuntimeError(
            "The machine did not respond in time. Check its connection and try again."
        ) from None
    if code:
        raise RuntimeError(stderr.strip()[-1800:] or f"{action} failed ({code}).")
    value: object = json.loads(stdout)
    return parse_metadata(value) if action == "stat" else parse_discovery(value)


def preview_dir(d: Path) -> Path:
    # The actual PDF is temporary; only status/configuration lives in the mod.
    saved = load(d / "preview-dir.json")
    if isinstance(saved, str):
        p = Path(saved)
        if p.is_dir() and not p.is_symlink() and p.stat().st_uid == os.getuid():
            return p
    p = Path(tempfile.mkdtemp(prefix="herdr-latex-"))
    atomic_json(d / "preview-dir.json", str(p))
    return p


def refresh(c: Config, d: Path, state: Status, force: bool = False) -> None:
    meta = query(c, "stat", cancel_dir=d)
    dest = Path(state["preview_path"])
    if not force and meta["stamp"] == state.get("stamp") and dest.is_file():
        return
    partial = dest.with_suffix(".pdf.part")
    size = meta["stamp"][1]
    if not 8 <= size <= MAX_PDF:
        raise RuntimeError("The PDF is empty or exceeds the 250 MiB preview limit.")
    try:
        with partial.open("wb") as out:
            for offset in range(0, size, CHUNK_SIZE):
                length = min(CHUNK_SIZE, size - offset)
                request = request_config(c)
                request.update(
                    {"offset": offset, "length": length, "expected_stamp": meta["stamp"]}
                )
                try:
                    r = run_interruptible(command(request, "download"), out, 35, d)
                except subprocess.TimeoutExpired:
                    raise RuntimeError(
                        "Herdr PDF transfer timed out. Keeping the previous local PDF and retrying shortly."
                    ) from None
                if r.returncode:
                    raise RuntimeError(
                        r.stderr.decode(errors="replace").strip()[-1800:]
                        or "Herdr PDF transfer failed."
                    )
                if out.tell() != offset + length:
                    raise RuntimeError(
                        "Herdr returned an incomplete PDF chunk. Keeping the previous local PDF."
                    )
                # Large transfers may span many requests; keep activity reporting live.
                state["heartbeat"] = time.time()
                atomic_json(d / "status.json", state)
        if partial.stat().st_size > MAX_PDF or partial.stat().st_size < 8:
            raise RuntimeError("The downloaded PDF is empty or too large.")
        after = query(c, "stat", cancel_dir=d)
        if after["stamp"] != meta["stamp"]:
            raise RuntimeError("PDF changed while fetching it; retrying shortly.")
        os.replace(partial, dest)
        state.update({"stamp": meta["stamp"], "updated": time.time(), "remote_pdf": meta["path"]})
    finally:
        partial.unlink(missing_ok=True)


def open_pdf(path: str, d: Path) -> subprocess.Popen[bytes]:
    opener = "open" if sys.platform == "darwin" else "xdg-open"
    if not shutil.which(opener):
        raise RuntimeError(f"{opener} is not installed. Local PDF: {path}")
    # Detached from helper lifetime; errors are checked on the next worker turn.
    log = (d / "viewer.log").open("wb")
    try:
        return subprocess.Popen([opener, path], stdout=log, stderr=log, start_new_session=True)
    finally:
        log.close()


def worker(d: Path) -> None:
    lock = (d / "worker.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    c = parse_config(load(d / "config.json"))
    old = parse_status(load(d / "status.json", {}))
    state: Status = old.copy()
    state.update(
        {
            "pid": os.getpid(),
            "worker_version": VERSION,
            "watching": False,
            "building": False,
            "cancelled": False,
            "phase": "Ready",
            "error": "",
        }
    )
    local = preview_dir(d)
    state["preview_path"] = str(local / "preview.pdf")
    build: subprocess.Popen[bytes] | None = None
    build_out: BinaryIO | None = None
    viewer: subprocess.Popen[bytes] | None = None
    build_started = 0.0
    preview_after_build = False
    last_request = time.monotonic()
    next_check = 0.0
    auto_open = False
    try:
        while True:
            now = time.monotonic()
            for req in sorted(d.glob("request-*.json")):
                request = record(load(req, {}))
                req.unlink(missing_ok=True)
                action = request.get("action")
                last_request = now
                state["error"] = ""
                try:
                    if action == "stop":
                        if build:
                            cancel_process(build)
                            build = None
                            if build_out is not None:
                                build_out.close()
                            build_out = None
                            state["build_code"] = None
                        state.update(
                            {
                                "watching": False,
                                "building": False,
                                "cancelled": True,
                                "phase": "Stopped",
                            }
                        )
                        auto_open = False
                        preview_after_build = False
                        (d / "stop-request.json").unlink(missing_ok=True)
                    elif action in ("compile", "build-preview"):
                        if build:
                            continue
                        if not c["tex"]:
                            raise RuntimeError("Choose a main .tex file first.")
                        build_out = (d / "build.log").open("wb")
                        build = subprocess.Popen(
                            command(c, "compile"),
                            stdout=build_out,
                            stderr=subprocess.STDOUT,
                            start_new_session=True,
                        )
                        build_started = now
                        preview_after_build = action == "build-preview"
                        state.update(
                            {
                                "building": True,
                                "cancelled": False,
                                "phase": "Compiling…",
                                "build_log": "",
                                "build_code": None,
                            }
                        )
                    elif action in ("preview", "refresh"):
                        state.update(
                            {"watching": True, "cancelled": False, "phase": "Fetching PDF…"}
                        )
                        auto_open = action == "preview"
                        next_check = 0
                except Exception as e:
                    state["error"] = str(e)
            if build:
                try:
                    with (d / "build.log").open("rb") as f:
                        f.seek(max(0, f.seek(0, 2) - 18000))
                        state["build_log"] = f.read().decode(errors="replace")
                except OSError:
                    pass
                code = build.poll()
                if code is None and now - build_started > 610:
                    os.killpg(build.pid, signal.SIGTERM)
                    code = build.wait(timeout=5)
                if code is not None:
                    if build_out is not None:
                        build_out.close()
                    build_out = None
                    build = None
                    state.update(
                        {
                            "building": False,
                            "build_code": code,
                            "phase": "Build succeeded" if code == 0 else "Build failed — see log",
                        }
                    )
                    if code == 0:
                        next_check = 0
                        if preview_after_build:
                            state["watching"] = True
                            auto_open = True
            if viewer and viewer.poll() is not None:
                if viewer.returncode:
                    state["error"] = (
                        "Could not open the local PDF: "
                        + (d / "viewer.log").read_text(errors="replace")[-1200:]
                    )
                viewer = None
            if state["watching"] and not build and now >= next_check:
                try:
                    refresh(c, d, state)
                    state["error"] = ""
                    state["phase"] = "Preview up to date · checking every 3 seconds"
                    if auto_open:
                        viewer = open_pdf(state["preview_path"], d)
                        auto_open = False
                except StopRequested:
                    state.update(
                        {"watching": False, "cancelled": True, "error": "", "phase": "Stopped"}
                    )
                    auto_open = False
                except Exception as e:
                    state.update(
                        {"error": str(e), "phase": "Waiting for PDF · retrying automatically"}
                    )
                next_check = time.monotonic() + INTERVAL
            state["heartbeat"] = time.time()
            atomic_json(d / "status.json", state)
            # Keep preview running across UI reloads, bounded to twelve hours.
            if not build and now - last_request > (43200 if state["watching"] else 600):
                break
            time.sleep(0.5)
    finally:
        state.update({"watching": False, "building": False, "pid": None, "phase": "Stopped"})
        atomic_json(d / "status.json", state)
        if build_out:
            build_out.close()


def main() -> None:
    os.umask(0o077)
    p = argparse.ArgumentParser()
    p.add_argument(
        "action",
        choices=[
            "compile",
            "build-preview",
            "preview",
            "refresh",
            "stop",
            "status",
            "discover",
            "worker",
        ],
    )
    p.add_argument("--config")
    p.add_argument("--directory")
    p.add_argument("--search", default="")
    args = p.parse_args()
    if args.action == "worker":
        worker(Path(args.directory))
        return
    c = config(args.config)
    d = session(c)
    if args.action == "discover":
        request = request_config(c)
        request["search"] = args.search
        print(json.dumps(query(request, "discover")))
        return
    if args.action == "status":
        print(
            json.dumps(
                {"status": load(d / "status.json", {}), "status_file": str(d / "status.json")}
            )
        )
        return
    old = parse_status(load(d / "status.json", {}))
    # Helpers survive UI reloads. Upgrade an idle helper before sending new actions.
    pid = old.get("pid")
    if pid is not None and old.get("worker_version") != VERSION:
        check = subprocess.run(
            ["ps", "-p", str(pid), "-o", "args="], capture_output=True, text=True
        )
        if str(Path(__file__).resolve()) in check.stdout and "worker" in check.stdout:
            if old.get("building"):
                raise RuntimeError(
                    "The existing build is still running. Wait for it to finish, then try again to load the updated panel helper."
                )
            try:
                if os.getpgid(pid) == pid:
                    os.killpg(pid, signal.SIGTERM)
                else:
                    os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            with (d / "worker.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
            if old.get("watching") and args.action == "compile":
                atomic_json(d / f"request-{time.time_ns()}-resume.json", {"action": "refresh"})
    atomic_json(d / "config.json", c)
    if args.action == "stop":
        atomic_json(d / "stop-request.json", {"stop": True})
    atomic_json(d / f"request-{time.time_ns()}-{uuid.uuid4().hex}.json", {"action": args.action})
    # Duplicate starts are harmless: worker.lock admits just one supervisor.
    log = (d / "helper.log").open("ab")
    subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "worker", "--directory", str(d)],
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
        start_new_session=True,
    )
    log.close()
    print(json.dumps({"directory": str(d), "status_file": str(d / "status.json")}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
