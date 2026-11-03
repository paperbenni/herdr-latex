"""Copy the toolbar and its shared dependencies without rewriting imports."""

import argparse
import shutil
from pathlib import Path

TOOLBAR_FILES = (
    "LICENSE",
    "toolbar-button.js",
    "session.js",
    "helper-client.js",
    "model.js",
    "contracts.d.ts",
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "destination", type=Path, help="Bundle directory inside your personal toolbar mod"
    )
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1] / "mods/latex"
    destination = args.destination.resolve()
    if destination == source:
        parser.error("Choose a destination outside the source mod.")
    destination.mkdir(parents=True, exist_ok=True)
    for name in TOOLBAR_FILES:
        shutil.copy2(source / name, destination / name)
    print(f"Toolbar bundle copied to {destination}")


if __name__ == "__main__":
    main()
