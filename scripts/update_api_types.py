"""Refresh development API snapshots from an installed Herdr app."""

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("home", type=Path, nargs="?", default=Path.home() / ".config/herdr-app")
    args = parser.parse_args()
    destination = Path(__file__).resolve().parents[1] / "types"
    for source, target in [("gpui-kit.d.ts", "gpui-api.d.ts"), ("herdr.d.ts", "herdr-api.d.ts")]:
        content = (args.home / source).read_text()
        if source == "gpui-kit.d.ts":
            # The generator emits a constructor signature for the runtime cx.new method.
            content = content.replace("new(Class: ViewClass,", '"new"(Class: ViewClass,')
        (destination / target).write_text(content)


if __name__ == "__main__":
    main()
