"""Typed, standalone worker sent to the selected Herdr machine with ``hc exec``."""

from __future__ import annotations

import collections
import itertools
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Literal, NotRequired, TypedDict, cast

Engine = Literal["pdflatex", "lualatex", "xelatex"]
Action = Literal["discover", "compile", "stat", "download"]


class Config(TypedDict):
    machine: str
    folder: str
    tex: str
    pdf: str
    engine: Engine


class Request(Config):
    search: NotRequired[str]
    offset: NotRequired[int]
    length: NotRequired[int]
    expected_stamp: NotRequired[list[int]]


class Metadata(TypedDict):
    stamp: list[int]
    path: str


class Document(TypedDict):
    path: str
    main: bool


class Discovery(TypedDict):
    files: list[Document]
    folder: str
    truncated: bool
    reason: str
    directories: int
    errors: list[str]
    search: str
    method: Literal["git", "walk", "skipped"]
    skipped: NotRequired[Literal["broad-folder"]]
    message: NotRequired[str]


class Status(TypedDict, total=False):
    preview_path: str
    stamp: list[int]
    updated: float
    remote_pdf: str
    build_code: int | None
    build_log: str
    pid: int | None
    worker_version: str
    watching: bool
    building: bool
    phase: str
    error: str
    heartbeat: float
    cancelled: bool


def record(value: object) -> dict[str, object]:
    """Narrow a JSON object only after checking its container and keys."""
    if not isinstance(value, dict) or not all(isinstance(k, str) for k in value):
        raise ValueError("Expected a JSON object.")
    return cast("dict[str, object]", value)


def text(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text.")
    return value


def integer(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{label} must be an integer.")
    return value


def parse_config(value: object) -> Config:
    obj = record(value)
    folder = text(obj.get("folder", ""), "Project folder").strip()
    if not folder:
        raise ValueError("Enter a project folder.")
    engine = text(obj.get("engine") or "pdflatex", "Engine")
    if engine not in ("pdflatex", "lualatex", "xelatex"):
        raise ValueError("Unknown LaTeX engine.")
    return Config(
        machine=text(obj.get("machine") or "", "Machine").strip(),
        folder=folder,
        tex=text(obj.get("tex") or "", "TeX path").strip(),
        pdf=text(obj.get("pdf") or "", "PDF path").strip(),
        engine=cast("Engine", engine),
    )


def parse_stamp(value: object) -> list[int]:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError("Invalid PDF metadata stamp.")
    return [integer(v, "PDF metadata") for v in value]


def parse_metadata(value: object) -> Metadata:
    obj = record(value)
    return Metadata(stamp=parse_stamp(obj.get("stamp")), path=text(obj.get("path"), "PDF path"))


def parse_discovery(value: object) -> Discovery:
    obj = record(value)
    items, errors = obj.get("files"), obj.get("errors")
    if not isinstance(items, list) or not isinstance(errors, list):
        raise ValueError("Invalid discovery response.")
    files: list[Document] = []
    for item in items:
        document = record(item)
        main = document.get("main")
        if not isinstance(main, bool):
            raise ValueError("Invalid document classification.")
        files.append(Document(path=text(document.get("path"), "Document path"), main=main))
    method, truncated = obj.get("method"), obj.get("truncated")
    if method not in ("git", "walk", "skipped") or not isinstance(truncated, bool):
        raise ValueError("Invalid discovery status.")
    result = Discovery(
        files=files,
        folder=text(obj.get("folder"), "Search folder"),
        truncated=truncated,
        reason=text(obj.get("reason"), "Search reason"),
        directories=integer(obj.get("directories"), "Directory count"),
        errors=[text(e, "Search error") for e in errors],
        search=text(obj.get("search"), "Search filter"),
        method=method,
    )
    if obj.get("skipped") == "broad-folder":
        result["skipped"] = "broad-folder"
        result["message"] = text(obj.get("message"), "Search message")
    return result


def parse_status(value: object) -> Status:
    """Read persisted status without letting unknown JSON fields enter the model."""
    obj = record(value)
    checked: dict[str, object] = {}
    strings = {"preview_path", "remote_pdf", "build_log", "worker_version", "phase", "error"}
    booleans = {"watching", "building", "cancelled"}
    for key, item in obj.items():
        if key in strings:
            checked[key] = text(item, key)
        elif key in booleans:
            if not isinstance(item, bool):
                raise ValueError(f"{key} must be boolean.")
            checked[key] = item
        elif key in {"pid", "build_code"}:
            checked[key] = None if item is None else integer(item, key)
        elif key in {"heartbeat", "updated"}:
            if (
                not isinstance(item, (float, int))
                or isinstance(item, bool)
                or not math.isfinite(item)
            ):
                raise ValueError(f"{key} must be a timestamp.")
            checked[key] = float(item)
        elif key == "stamp":
            checked[key] = parse_stamp(item)
    # Every retained key and its value type has been validated above.
    return cast("Status", checked)


def protected_directories() -> tuple[set[Path], set[tuple[int, int]]]:
    home = Path.home().resolve()
    paths = {home, *home.parents}
    paths.update(
        Path(p)
        for p in (
            "/home",
            "/Users",
            "/root",
            "/tmp",
            "/var",
            "/var/tmp",
            "/usr",
            "/etc",
            "/opt",
            "/srv",
            "/mnt",
            "/media",
            "/Volumes",
            "/vol",
        )
    )
    identities: set[tuple[int, int]] = set()
    for path in paths:
        try:
            info = path.stat()
            identities.add((info.st_dev, info.st_ino))
        except OSError:
            pass
    return paths, identities


def git_documents(folder: Path) -> list[Path] | None:
    if not shutil.which("git"):
        return None
    try:
        probe = subprocess.run(
            ["git", "-C", str(folder), "rev-parse", "--is-inside-work-tree"],
            capture_output=True,
            timeout=1,
            check=False,
        )
        if probe.returncode or probe.stdout.strip() != b"true":
            return None
        patterns = ["*." + "".join(ext) for ext in itertools.product("tT", "eE", "xX")]
        found = subprocess.run(
            [
                "git",
                "-C",
                str(folder),
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "--",
                *patterns,
            ],
            capture_output=True,
            timeout=2,
            check=False,
        )
        if found.returncode == 0:
            return [folder / os.fsdecode(p) for p in found.stdout.split(b"\0") if p]
    except subprocess.TimeoutExpired:
        pass
    return None


def discover(folder: Path, search: str = "") -> Discovery:
    if not folder.is_dir():
        raise ValueError(f"Project folder does not exist: {folder}")
    broad, broad_ids = protected_directories()
    info = folder.stat()
    result = Discovery(
        files=[],
        folder=str(folder),
        truncated=False,
        reason="",
        directories=0,
        errors=[],
        search=search,
        method="walk",
    )
    if folder in broad or (info.st_dev, info.st_ino) in broad_ids:
        result.update(
            {
                "method": "skipped",
                "skipped": "broad-folder",
                "message": "Open a project folder in Herdr to find TeX documents.",
            }
        )
        return result
    seen: set[tuple[int, int]] = set()
    pending = collections.deque([folder])
    started, needle = time.monotonic(), search.casefold()
    candidates = git_documents(folder)

    def add_file(path: Path) -> None:
        relative = str(path.relative_to(folder))
        if needle and needle not in relative.casefold():
            return
        try:
            with path.open(errors="replace") as file:
                head = file.read(16384)
            main = bool(re.search(r"(?m)^[ \t]*\\documentclass\b", head))
        except OSError as error:
            result["errors"].append(str(error))
            return
        result["files"].append(Document(path=relative, main=main))

    if candidates is not None:
        pending.clear()
        result["method"] = "git"
        for path in candidates:
            if time.monotonic() - started > 3 or len(result["files"]) >= 2000:
                result["reason"] = (
                    "Search is partial. Enter a filename filter, or cd into a narrower folder in Herdr."
                )
                break
            add_file(path)
    while pending:
        if len(seen) >= 10000 or time.monotonic() - started > 2:
            result["reason"] = (
                "Search reached its directory or time limit. Enter a filename filter, or cd into a narrower folder in Herdr."
            )
            break
        parent = pending.popleft()
        try:
            info = parent.stat()
            identity = (info.st_dev, info.st_ino)
            if identity in broad_ids or identity in seen:
                continue
            seen.add(identity)
            with os.scandir(parent) as listing:
                entries = sorted(listing, key=lambda e: e.name.casefold())
        except OSError as error:
            result["errors"].append(str(error))
            continue
        for entry in entries:
            if time.monotonic() - started > 2:
                result["reason"] = (
                    "Search is partial. Enter a filename filter, or cd into a narrower folder in Herdr."
                )
                break
            try:
                path = Path(entry.path)
                if entry.is_dir():
                    if not entry.name.startswith(".") and entry.name not in (
                        "node_modules",
                        "venv",
                        "__pycache__",
                        "build",
                        "_build",
                        "dist",
                    ):
                        pending.append(path)
                elif entry.name.lower().endswith(".tex") and entry.is_file():
                    add_file(path)
                    if len(result["files"]) >= 2000:
                        result["reason"] = (
                            "Showing the first 2,000 matching TeX files. Enter a filename filter, or cd into a narrower folder in Herdr."
                        )
                        break
            except OSError as error:
                result["errors"].append(str(error))
        if result["reason"]:
            break
    result["files"].sort(key=lambda f: (not f["main"], f["path"].casefold()))
    result.update(
        {
            "truncated": bool(result["reason"]),
            "directories": len(seen),
            "errors": result["errors"][:5],
        }
    )
    return result


def metadata(pdf: Path) -> Metadata:
    if not pdf.is_file():
        raise ValueError(f"PDF not found: {pdf}. Compile first, or set the PDF output path.")
    info = pdf.stat()
    return Metadata(stamp=[info.st_mtime_ns, info.st_size, info.st_ino], path=str(pdf))


def compile_document(folder: Path, tex: Path, engine: Engine) -> int:
    if not tex.is_file():
        raise ValueError(f"Main TeX file does not exist: {tex}")
    if not shutil.which("latexmk"):
        raise ValueError("latexmk is not installed or is not on PATH on this machine.")
    flag = {"pdflatex": "-pdf", "lualatex": "-lualatex", "xelatex": "-xelatex"}[engine]
    return subprocess.call(
        [
            "latexmk",
            flag,
            "-cd",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-file-line-error",
            "-synctex=1",
            str(tex),
        ],
        cwd=folder,
    )


def download(pdf: Path, request: dict[str, object]) -> None:
    before = metadata(pdf)["stamp"]
    if before[1] > 250 * 1024 * 1024:
        raise ValueError("PDF exceeds the 250 MiB preview limit.")
    if request.get("expected_stamp") is not None and before != parse_stamp(
        request["expected_stamp"]
    ):
        raise ValueError("PDF changed while fetching it; retrying shortly.")
    offset = integer(request.get("offset", 0), "Chunk offset")
    length = integer(request.get("length", 4 * 1024 * 1024), "Chunk length")
    if offset < 0 or not 0 < length <= 4 * 1024 * 1024:
        raise ValueError("Invalid PDF chunk range.")
    if offset == 0:
        time.sleep(0.65)
    if metadata(pdf)["stamp"] != before:
        raise ValueError("PDF is still being written; retrying on the next check.")
    with pdf.open("rb") as file:
        if file.read(5) != b"%PDF-":
            raise ValueError("The output is not a PDF yet.")
        file.seek(max(0, before[1] - 2048))
        if b"%%EOF" not in file.read():
            raise ValueError("PDF is incomplete; waiting for the compiler to finish.")
        file.seek(offset)
        sys.stdout.buffer.write(file.read(length))
    sys.stdout.buffer.flush()
    if metadata(pdf)["stamp"] != before:
        raise ValueError("PDF changed during download; keeping the previous preview.")


def main() -> int:
    action, raw = sys.argv[1:3]
    value: object = json.loads(raw)
    request = record(value)
    cfg = parse_config(request)
    folder = Path(cfg["folder"]).expanduser().resolve()
    tex = Path(cfg["tex"] or "main.tex").expanduser()
    tex = tex if tex.is_absolute() else folder / tex
    pdf = Path(cfg["pdf"]).expanduser() if cfg["pdf"] else tex.with_suffix(".pdf")
    pdf = pdf if pdf.is_absolute() else folder / pdf
    if action == "discover":
        print(json.dumps(discover(folder, text(request.get("search", ""), "Search filter"))))
    elif action == "compile":
        return compile_document(folder, tex, cfg["engine"])
    elif action == "stat":
        print(json.dumps(metadata(pdf)))
    elif action == "download":
        download(pdf, request)
    else:
        raise ValueError(f"Unknown remote action: {action}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
