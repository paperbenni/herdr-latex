# Herdr LaTeX

A LaTeX panel for [Herdr](https://herdr.dev). Compile in your current local or
remote session, then preview an automatically updated local PDF in your desktop
viewer. No remote filesystem mount or embedded PDF reader is needed.

![Herdr LaTeX panel](preview.png)

## Install

Ask your Herdr coding agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then install the mod from
https://github.com/paperbenni/herdr-latex.
Add a LaTeX button to my current Herdr toolbar so I can open the panel with one click.
Read RECIPE.md and all the files before installing. Clone any shipped layout or
toolbar mod before changing it, and preserve my other customizations.
```

The repository uses Herdr's community mod format: `mods/latex/`, `RECIPE.md` and
`preview.png`. The installer agent should copy the mod, check it, and connect a
toolbar button to `run("mod.open", { name: "latex" })`. A personal layout is not
bundled, so installation can fit your existing layout.

For a manual install, copy `mods/latex` into `~/.config/herdr-app/mods/latex` without
overwriting an existing mod. Then run:

```sh
herdr-app check ~/.config/herdr-app/mods/latex
herdr-app do mod.open --name latex
```

## Use

1. Focus the Herdr session containing your project, then click **LaTeX**.
2. Select the main document found in the current working directory. Main files
   containing `\documentclass` appear first; included chapter files can be shown too.
3. Click **Compile & Preview**. The PDF opens only after compilation succeeds.

The panel follows the active session's machine and live working directory. Use
Herdr's existing navigation or `cd` to change projects. Document and engine
preferences are remembered per machine and folder.

- **Compile** runs `latexmk` and exposes the build log.
- **Preview** opens an existing PDF without compiling and checks for updates every
  three seconds. A changed PDF is downloaded in full and atomically replaces the
  same local file. An interrupted or incomplete download keeps the previous PDF.
- **Refresh now** checks immediately; **Stop updates** ends the polling session.
- **PDF output settings** lets you select a custom output path such as
  `build/slides.pdf`. The compiler's output location remains controlled by your
  LaTeX project configuration.

Your viewer provides zoom, text selection, search and links. Its automatic reload
behavior determines how it responds when the local PDF is replaced. SyncTeX
editor integration is not included.

## Requirements and access

Tested with Herdr 0.1.12 on Linux. The code also selects macOS's `open` launcher,
but macOS has not been tested. Windows is not supported.

- **Local computer:** Python 3, `hc`, `ssh`, a PDF viewer, and `xdg-open` on Linux
  or `open` on macOS.
- **Machine doing the build:** Python 3, `latexmk`, and the selected engine
  (`pdflatex`, `lualatex` or `xelatex`).
- **Remote preview:** the Herdr machine must have a usable SSH target and
  noninteractive SSH authentication through your SSH config and agent. A connected
  Herdr core by itself does not guarantee that a separate SSH download will work.

This is trusted mod code. It reads TeX sources and PDFs in your working folder,
runs builds through `hc`, uses SSH for remote scans/downloads, writes a temporary
local PDF, and launches your default viewer. LaTeX builds can also execute the
project's existing `latexmk` configuration. It does not store SSH passwords or
upload your documents to a service.

Builds are limited to ten minutes. Preview helpers survive panel closure and stop
after twelve hours without a button action. PDF downloads are limited to 250 MiB.
File searches follow directory symlinks safely, skip common hidden/cache folders,
and report partial results at 2,000 matches, 10,000 directories or eight seconds.
Narrow the filename filter or `cd` into a more specific directory when needed.

Session files and build logs live under the installed mod's `.runtime/` directory.
The local PDF lives in a private OS temporary directory. These files and Herdr's
generated typings are excluded from this repository.

## Development

The runtime sources are `mods/latex/main.js`, `helper.py` and `mod.json`.
See [RECIPE.md](RECIPE.md) for the interface and integration behavior.

```sh
herdr-app check ./mods/latex
python3 -m unittest discover -s mods/latex/tests -v
node --test mods/latex/tests/test_context.cjs
```

The Python integration tests additionally need local `latexmk`, `pdflatex`, and
`pdfinfo`. The JavaScript context tests use Node's built-in test runner; Node is
not required to run the installed mod.
