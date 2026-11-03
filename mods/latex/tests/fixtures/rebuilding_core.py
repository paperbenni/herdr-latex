#!/usr/bin/env python3
"""hc test double: start an external rebuild when the first download begins."""

import json
import os
import sys
from pathlib import Path


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :]
    request = json.loads(argv[-1])
    marker = Path(os.environ["LATEX_TEST_REBUILD"])
    armed = marker.with_suffix(".armed")
    if argv[-2] == "download" and armed.exists():
        with marker.with_suffix(".attempts").open("a") as attempts:
            attempts.write("download\n")
    if argv[-2] == "download" and armed.exists() and not marker.exists():
        folder = Path(request["folder"])
        tex = folder / request["tex"]
        pdf = folder / request["pdf"] if request["pdf"] else tex.with_suffix(".pdf")
        pdf.write_bytes(b"%PDF-1.4\nexternal compiler is still writing")
        marker.touch()
    os.execvp(argv[0], argv)


if __name__ == "__main__":
    main()
