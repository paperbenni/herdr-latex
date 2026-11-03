import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch

import helper
import remote
from remote import Action, Config, Request, Status, parse_status, record, text


class PreviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(prefix="herdr-latex-test-")
        self.root = Path(self.tmp.name)
        self.project = self.root / "paper's folder with spaces"
        self.project.mkdir()
        self.pdf = self.project / "main.pdf"
        self.pdf.write_bytes(b"%PDF-1.4\nfirst version\n%%EOF\n")
        self.dest = self.root / "preview.pdf"
        self.cfg: Config = {
            "machine": "",
            "folder": str(self.project),
            "tex": "main.tex",
            "pdf": "",
            "engine": "pdflatex",
        }
        self.state: Status = {"preview_path": str(self.dest)}

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_download_then_metadata_check_avoids_retransfer(self) -> None:
        helper.refresh(self.cfg, self.root, self.state)
        self.assertEqual(self.dest.read_bytes(), self.pdf.read_bytes())
        before = self.dest.stat().st_mtime_ns
        helper.refresh(self.cfg, self.root, self.state)
        self.assertEqual(self.dest.stat().st_mtime_ns, before)
        self.pdf.write_bytes(b"%PDF-1.4\nsecond version, longer\n%%EOF\n")
        helper.refresh(self.cfg, self.root, self.state)
        self.assertEqual(self.dest.read_bytes(), self.pdf.read_bytes())

    def test_invalid_replacement_preserves_previous_preview(self) -> None:
        helper.refresh(self.cfg, self.root, self.state)
        original = self.dest.read_bytes()
        stamp = self.state["stamp"]
        self.pdf.write_bytes(b"partially written output")
        with self.assertRaisesRegex(RuntimeError, "not a PDF"):
            helper.refresh(self.cfg, self.root, self.state)
        self.assertEqual(self.dest.read_bytes(), original)
        self.assertEqual(self.state["stamp"], stamp)
        self.assertFalse(self.dest.with_suffix(".pdf.part").exists())

    def test_remote_changes_during_transfer_preserve_preview(self) -> None:
        helper.refresh(self.cfg, self.root, self.state)
        original = self.dest.read_bytes()
        self.pdf.write_bytes(b"%PDF-1.4\nchanged upstream content\n%%EOF\n")
        meta = helper.query(self.cfg, "stat")
        after = {**meta, "stamp": [meta["stamp"][0] + 1, *meta["stamp"][1:]]}
        with patch.object(helper, "query", side_effect=[meta, after]):
            with self.assertRaisesRegex(RuntimeError, "changed while fetching"):
                helper.refresh(self.cfg, self.root, self.state)
        self.assertEqual(self.dest.read_bytes(), original)

    def test_pdf_header_without_end_marker_is_not_published(self) -> None:
        helper.refresh(self.cfg, self.root, self.state)
        original = self.dest.read_bytes()
        self.pdf.write_bytes(b"%PDF-1.4\ncompiler has not finished")
        with self.assertRaisesRegex(RuntimeError, "incomplete"):
            helper.refresh(self.cfg, self.root, self.state)
        self.assertEqual(self.dest.read_bytes(), original)

    def test_nested_tex_and_custom_output_discovery(self) -> None:
        sub = self.project / "chapters"
        sub.mkdir()
        (sub / "main.tex").write_text("test")
        (self.project / "main.tex").write_text("test")
        files = helper.query(self.cfg, "discover")
        self.assertEqual([f["path"] for f in files["files"]], ["chapters/main.tex", "main.tex"])
        self.assertFalse(files["truncated"])
        self.cfg["pdf"] = "build/output.pdf"
        (self.project / "build").mkdir()
        (self.project / self.cfg["pdf"]).write_bytes(self.pdf.read_bytes())
        meta = helper.query(self.cfg, "stat")
        self.assertEqual(meta["path"], str(self.project / self.cfg["pdf"]))

    def test_discovery_prioritizes_main_documents_and_finds_deep_symlinks(self) -> None:
        (self.project / "chapter.tex").write_text("included chapter")
        deep = self.project.joinpath(*["nested"] * 8)
        deep.mkdir(parents=True)
        (deep / "deep.TEX").write_text(r"\documentclass{article}")
        external = self.root / "linked source"
        external.mkdir()
        (external / "slides.tex").write_text("% comment\n" + r"\documentclass{beamer}")
        (self.project / "slides").symlink_to(external, target_is_directory=True)
        (external / "cycle").symlink_to(self.project, target_is_directory=True)
        result = helper.query(self.cfg, "discover")
        self.assertFalse(result["truncated"])
        self.assertEqual(len(result["files"]), 3)
        self.assertTrue(result["files"][0]["main"])
        self.assertTrue(result["files"][1]["main"])
        self.assertIn("slides/slides.tex", [f["path"] for f in result["files"]])

    def test_discovery_reports_result_limits_and_search_can_find_later_files(self) -> None:
        for i in range(2001):
            (self.project / f"a-{i:04}.tex").write_text("chapter")
        (self.project / "slides.tex").write_text(r"\documentclass{beamer}")
        result = helper.query(self.cfg, "discover")
        self.assertTrue(result["truncated"])
        self.assertTrue(result["reason"])
        request = helper.request_config(self.cfg)
        request["search"] = "slides"
        result = helper.query(request, "discover")
        self.assertFalse(result["truncated"])
        self.assertEqual(result["files"], [{"path": "slides.tex", "main": True}])

    def test_discovery_missing_folder_explains_the_problem(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Project folder does not exist"):
            helper.query({**self.cfg, "folder": str(self.root / "missing")}, "discover")

    def test_home_and_its_ancestors_are_never_scanned_even_with_a_filter(self) -> None:
        (self.project / "main.tex").write_text(r"\documentclass{article}")
        # Fail if discovery tries to enumerate files or invoke Git at all.
        with (
            patch.dict(os.environ, {"HOME": str(self.project)}),
            patch.object(os, "scandir", side_effect=AssertionError("Unexpected scan")),
            patch.object(subprocess, "run", side_effect=AssertionError("Unexpected Git")),
        ):
            for folder in [self.project, self.root, Path("/")]:
                result = remote.discover(folder.resolve(), "main")
                self.assertEqual(result["skipped"], "broad-folder")
                self.assertEqual(result["files"], [])
                self.assertEqual(result["directories"], 0)

    def test_home_aliases_and_system_roots_are_skipped(self) -> None:
        alias = self.root / "home-alias"
        alias.symlink_to(self.project, target_is_directory=True)
        with patch.dict(os.environ, {"HOME": str(self.project)}):
            self.assertEqual(
                helper.query({**self.cfg, "folder": str(alias)}, "discover")["skipped"],
                "broad-folder",
            )
        self.assertEqual(
            helper.query({**self.cfg, "folder": "/tmp"}, "discover")["skipped"], "broad-folder"
        )

    def test_project_subfolders_of_home_are_still_searched(self) -> None:
        (self.project / "main.tex").write_text(r"\documentclass{article}")
        with patch.dict(os.environ, {"HOME": str(self.root)}):
            result = helper.query(self.cfg, "discover")
        self.assertEqual(result["files"], [{"path": "main.tex", "main": True}])
        self.assertNotIn("skipped", result)

    def test_project_symlink_to_home_does_not_expand_the_home_tree(self) -> None:
        outside = self.root / "user-home"
        outside.mkdir()
        (outside / "unrelated.tex").write_text(r"\documentclass{article}")
        (self.project / "whole-home").symlink_to(outside, target_is_directory=True)
        (self.project / "main.tex").write_text(r"\documentclass{article}")
        with patch.dict(os.environ, {"HOME": str(outside)}):
            result = helper.query(self.cfg, "discover")
        self.assertEqual(result["files"], [{"path": "main.tex", "main": True}])

    def test_all_remote_actions_reuse_herdr_without_shell_expansion(self) -> None:
        self.cfg["machine"] = "example"
        self.cfg["folder"] = "/tmp/paper's $(touch NEVER); folder"
        actions: list[Action] = ["stat", "discover", "download", "compile"]
        for action in actions:
            cmd = helper.command(self.cfg, action)
            self.assertEqual(cmd[:4], ["hc", "exec", "--on", "example"])
            self.assertEqual(json.loads(cmd[-1]), self.cfg)
            self.assertEqual(cmd[-2], action)
            self.assertNotEqual(cmd[0], "ssh")

    def test_pdf_larger_than_core_output_limit_is_transferred_in_exact_chunks(self) -> None:
        payload = b"%PDF-1.7\n" + bytes(range(256)) * 40960 + b"\n%%EOF\n"
        self.pdf.write_bytes(payload)
        requests: list[Request] = []
        original = helper.command

        def record(c: Request, action: Action) -> list[str]:
            if action == "download":
                requests.append(c)
            return original(c, action)

        with patch.object(helper, "command", side_effect=record):
            helper.refresh(self.cfg, self.root, self.state)
        self.assertEqual(self.dest.read_bytes(), payload)
        self.assertEqual(len(requests), 3)
        self.assertTrue(all(r["length"] <= 4 * 1024 * 1024 for r in requests))
        self.assertEqual(sum(r["length"] for r in requests), len(payload))

    def test_short_core_transfer_keeps_previous_local_pdf(self) -> None:
        helper.refresh(self.cfg, self.root, self.state)
        original_pdf = self.dest.read_bytes()
        self.pdf.write_bytes(b"%PDF-1.7\nA new version with more content\n%%EOF\n")
        original = helper.command

        def truncated(c: Request, action: Action) -> list[str]:
            if action == "download":
                return ["python3", "-c", 'print("%PDF-1.7")']
            return original(c, action)

        with patch.object(helper, "command", side_effect=truncated):
            with self.assertRaisesRegex(RuntimeError, "incomplete PDF chunk"):
                helper.refresh(self.cfg, self.root, self.state)
        self.assertEqual(self.dest.read_bytes(), original_pdf)

    def test_git_discovery_respects_ignored_files_and_includes_untracked_tex(self) -> None:
        subprocess.run(["git", "init", "-q", str(self.project)], check=True)
        (self.project / ".gitignore").write_text("generated/\n")
        (self.project / "slides.tex").write_text(r"\documentclass{beamer}")
        generated = self.project / "generated"
        generated.mkdir()
        (generated / "ignored.tex").write_text(r"\documentclass{article}")
        result = helper.query(self.cfg, "discover")
        self.assertEqual(result["method"], "git")
        self.assertFalse(result["truncated"])
        self.assertEqual(result["files"], [{"path": "slides.tex", "main": True}])

    def test_compile_real_latex_document_in_path_with_spaces(self) -> None:
        (self.project / "main.tex").write_text(
            r"\documentclass{article}\begin{document}Hello $E=mc^2$.\end{document}"
        )
        r = subprocess.run(helper.command(self.cfg, "compile"), capture_output=True, timeout=40)
        self.assertEqual(
            r.returncode,
            0,
            r.stdout.decode(errors="replace")[-2000:] + r.stderr.decode(errors="replace"),
        )
        self.assertTrue((self.project / "main.synctex.gz").exists())
        info = subprocess.check_output(["pdfinfo", str(self.pdf)], text=True)
        self.assertIn("Pages:", info)

    def test_stop_interrupts_an_in_progress_transfer(self) -> None:
        timer = threading.Timer(0.2, lambda: (self.root / "stop-request.json").write_text("{}"))
        timer.start()
        started = time.monotonic()
        try:
            with self.assertRaises(helper.StopRequested):
                helper.run_interruptible(
                    ["python3", "-c", "import time; time.sleep(60)"], subprocess.PIPE, 65, self.root
                )
        finally:
            timer.cancel()
        self.assertLess(time.monotonic() - started, 3)

    def test_stop_cancels_a_running_build_without_starting_preview(self) -> None:
        helper_copy = self.root / "helper.py"
        shutil.copyfile(Path(helper.__file__), helper_copy)
        shutil.copyfile(Path(helper.__file__).with_name("remote.py"), self.root / "remote.py")
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        marker = self.root / "engine.pid"
        engine = fake_bin / "latexmk"
        engine.write_text(
            '#!/usr/bin/env python3\nimport os,pathlib,time\npathlib.Path(os.environ["LATEX_TEST_PID"]).write_text(str(os.getpid()))\ntime.sleep(60)\n'
        )
        engine.chmod(0o700)
        (self.project / "main.tex").write_text(r"\documentclass{article}")
        env = {
            **os.environ,
            "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
            "LATEX_TEST_PID": str(marker),
        }

        def submit(action: str) -> dict[str, object]:
            r = subprocess.run(
                [sys.executable, str(helper_copy), action, "--config", json.dumps(self.cfg)],
                env=env,
                capture_output=True,
                text=True,
                check=True,
            )
            return record(json.loads(r.stdout))

        result = submit("build-preview")
        status_path = Path(text(result["status_file"], "status file"))

        def wait_for(predicate: Callable[[Status], bool]) -> Status:
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                state = parse_status(helper.load(status_path, {}))
                if predicate(state):
                    return state
                time.sleep(0.1)
            self.fail(
                "Build did not reach expected state: "
                + str(parse_status(helper.load(status_path, {})))
            )

        try:
            wait_for(lambda s: s.get("building", False) and marker.exists())
            started = time.monotonic()
            submit("stop")
            state = wait_for(
                lambda s: (
                    s.get("cancelled", False) and not s.get("building") and not s.get("watching")
                )
            )
            self.assertLess(time.monotonic() - started, 4)
            self.assertEqual(state["phase"], "Stopped")
            self.assertIsNone(state["build_code"])
            self.assertFalse(state.get("updated"))
            live = subprocess.run(
                ["ps", "-p", marker.read_text(), "-o", "stat="], capture_output=True, text=True
            )
            self.assertTrue(not live.stdout.strip() or live.stdout.strip().startswith("Z"))
        finally:
            state = parse_status(helper.load(status_path, {}))
            if (pid := state.get("pid")) is not None:
                try:
                    os.killpg(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            if state.get("preview_path"):
                shutil.rmtree(Path(state["preview_path"]).parent, ignore_errors=True)

    def test_background_preview_opens_updates_and_stops(self) -> None:
        # Exercise the actual detached supervisor, replacing only the OS viewer.
        helper_copy = self.root / "helper.py"
        shutil.copyfile(Path(helper.__file__), helper_copy)
        shutil.copyfile(Path(helper.__file__).with_name("remote.py"), self.root / "remote.py")
        fake_bin = self.root / "bin"
        fake_bin.mkdir()
        marker = self.root / "opened.txt"
        opener = fake_bin / ("open" if sys.platform == "darwin" else "xdg-open")
        opener.write_text('#!/bin/sh\nprintf "%s" "$1" > "$LATEX_TEST_OPENED"\n')
        opener.chmod(0o700)
        env = {
            **os.environ,
            "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
            "LATEX_TEST_OPENED": str(marker),
        }

        def submit(action: str) -> dict[str, object]:
            r = subprocess.run(
                [sys.executable, str(helper_copy), action, "--config", json.dumps(self.cfg)],
                env=env,
                capture_output=True,
                text=True,
                check=True,
            )
            return record(json.loads(r.stdout))

        def wait_for(predicate: Callable[[Status], bool], seconds: float = 16) -> Status:
            until = time.monotonic() + seconds
            while time.monotonic() < until:
                value = parse_status(helper.load(status_path, {}))
                if predicate(value):
                    return value
                time.sleep(0.2)
            self.fail("Supervisor timed out: " + str(parse_status(helper.load(status_path, {}))))

        (self.project / "main.tex").write_text("Invalid TeX document")
        result = submit("build-preview")
        status_path = Path(text(result["status_file"], "status file"))
        state: Status = {}
        try:
            wait_for(lambda s: s.get("build_code") is not None and s.get("build_code") != 0)
            self.assertFalse(marker.exists(), "Failed builds must not open the viewer")
            (self.project / "main.tex").write_text(
                r"\documentclass{article}\begin{document}Preview test.\end{document}"
            )
            submit("build-preview")
            state = wait_for(
                lambda s: (
                    s.get("build_code") == 0
                    and s.get("watching", False)
                    and s.get("updated", 0) > 0
                    and marker.exists()
                )
            )
            dest = Path(state["preview_path"])
            self.assertEqual(marker.read_text(), str(dest))
            original = dest.read_bytes()
            self.pdf.write_bytes(b"%PDF-1.4\nnot finished")
            wait_for(lambda s: "incomplete" in s.get("error", ""))
            self.assertEqual(dest.read_bytes(), original)
            self.pdf.write_bytes(b"%PDF-1.4\nnew complete version\n%%EOF\n")
            wait_for(lambda s: not s.get("error") and s.get("updated", 0) > state["updated"])
            self.assertEqual(dest.read_bytes(), self.pdf.read_bytes())
            old_pid = parse_status(helper.load(status_path, {}))["pid"]
            with helper_copy.open("a") as f:
                f.write("\n# Simulated helper upgrade\n")
            submit("refresh")
            wait_for(lambda s: s.get("pid") != old_pid and s.get("watching", False))
            self.assertEqual(dest.read_bytes(), self.pdf.read_bytes())
            submit("stop")
            wait_for(lambda s: s.get("watching") is False)
        finally:
            latest = parse_status(helper.load(status_path, {}))
            if (pid := latest.get("pid")) is not None:
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            if latest.get("preview_path"):
                shutil.rmtree(Path(latest["preview_path"]).parent, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
