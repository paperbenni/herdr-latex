"""Exercise recovery in a real detached worker without a Stop/Start action."""

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path

import helper
import pytest
from remote import Config, Status, parse_status, record, text


def test_worker_recovers_from_an_external_rebuild(tmp_path: Path) -> None:
    for name in ("helper.py", "remote.py"):
        shutil.copyfile(Path(helper.__file__).with_name(name), tmp_path / name)
    project = tmp_path / "project"
    project.mkdir()
    pdf = project / "main.pdf"
    ready = b"%PDF-1.4\nlast complete build\n%%EOF\n"
    latest = b"%PDF-1.4\nnew complete build from another agent\n%%EOF\n"
    pdf.write_bytes(ready)
    cfg: Config = {
        "machine": "external-builder",
        "folder": str(project),
        "tex": "main.tex",
        "pdf": "",
        "engine": "pdflatex",
    }
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    core = fake_bin / "hc"
    shutil.copyfile(Path(__file__).parent / "fixtures/rebuilding_core.py", core)
    core.chmod(0o700)
    opener = fake_bin / ("open" if sys.platform == "darwin" else "xdg-open")
    opener.symlink_to(shutil.which("true") or "/bin/true")
    marker = tmp_path / "external-rebuild"
    env = {
        **os.environ,
        "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
        "LATEX_TEST_REBUILD": str(marker),
    }
    result = subprocess.run(
        [sys.executable, str(tmp_path / "helper.py"), "preview", "--config", json.dumps(cfg)],
        env=env,
        capture_output=True,
        text=True,
        check=True,
        timeout=5,
    )
    reply = record(json.loads(result.stdout))
    status_file = Path(text(reply["status_file"], "status file"))

    def wait_for(predicate: Callable[[Status], bool]) -> Status:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            state = parse_status(helper.load(status_file, {}))
            if predicate(state):
                return state
            time.sleep(0.1)
        pytest.fail(f"Worker did not recover: {helper.load(status_file, {})}")

    try:
        state = wait_for(lambda s: bool(s.get("updated")))
        preview = Path(state["preview_path"])
        pid = state["pid"]
        assert preview.read_bytes() == ready
        # Start another build after preview is established, then replace the source
        # during its transfer. The fixture keeps it incomplete for several retries.
        pdf.write_bytes(b"%PDF-1.4\nsecond complete build\n%%EOF\n")
        marker.with_suffix(".armed").touch()
        wait_for(lambda s: "changed while fetching" in s.get("error", ""))
        assert preview.read_bytes() == ready
        wait_for(lambda s: "incomplete" in s.get("error", ""))
        attempts = marker.with_suffix(".attempts")
        wait_for(lambda s: attempts.exists() and len(attempts.read_text().splitlines()) >= 3)
        assert preview.read_bytes() == ready
        replacement = project / "new.pdf"
        replacement.write_bytes(latest)
        replacement.replace(pdf)
        recovered = wait_for(
            lambda s: not s.get("error") and s.get("updated", 0) > state["updated"]
        )
        assert recovered["pid"] == pid
        assert recovered["watching"] is True
        assert recovered["preview_path"] == str(preview)
        assert preview.read_bytes() == latest
    finally:
        state = parse_status(helper.load(status_file, {}))
        if (pid := state.get("pid")) is not None:
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        if state.get("preview_path"):
            shutil.rmtree(Path(state["preview_path"]).parent, ignore_errors=True)
