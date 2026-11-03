# Herdr LaTeX

A LaTeX panel for [Herdr](https://herdr.dev). Compile in your current local or
remote session, then preview an automatically updated local PDF in your desktop
viewer. No remote filesystem mount or embedded PDF reader is needed.

![LaTeX panel with an active remote preview and a Stop button](preview.png)

An active preview keeps the local PDF updated. The primary button becomes **Stop**
until you end the build or preview.

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
`preview.png`. The installer agent should copy the mod, check it, and mount the
provided toolbar component with live context forwarding. A personal layout is not
bundled, so installation can fit your existing layout.

For the activity indicator, copy the toolbar bundle into your personal toolbar
mod, preserving its internal imports:

```sh
just toolbar-bundle ~/.config/herdr-app/mods/my-toolbar/latex
```

Import `LatexToolbarButton` and `latexButtonContext` from
`./latex/toolbar-button.js`, mount the View with `cx.new()` in the toolbar's
`init`, and render the returned entity. Forward `latexButtonContext()` when the
parent's live context changes. See [RECIPE.md](RECIPE.md) for the full example.
The bundle command copies files; it does not edit your layout or toolbar View.

For a manual install, copy `mods/latex` into `~/.config/herdr-app/mods/latex` without
overwriting an existing mod. Then run:

```sh
herdr-app check ~/.config/herdr-app/mods/latex
herdr-app do mod.open --name latex
```

## Use

1. Focus the Herdr session containing your project, then click **LaTeX**.
2. Select the main document found in the current working directory. Click the
   document card to choose a different file. Main files
   containing `\documentclass` appear first; included chapter files can be shown too.
3. Click **Compile & Preview**. The PDF opens only after compilation succeeds.

The panel follows the active session's machine and live working directory. Use
Herdr's existing navigation or `cd` to change projects. Document and engine
preferences are remembered per machine and folder.

Discovery is paused in home directories, their ancestors and common system or
temporary roots. The panel asks you to navigate to a project directory instead
of searching through unrelated files. Project subfolders still work normally;
you can also enter an explicit file path without scanning.

The toolbar button turns **green with ▶** when a build or preview belongs to the
current machine and folder, including when the panel is closed. Activity in a
different folder is shown as a small green dot on a neutral button. Clicking then
offers **Open LaTeX here** or **Go to active preview**. Jumping reuses a matching
project pane if available, or opens a tab at that folder. Opening here preserves
your current session and does not stop the other preview.

- **Compile only** (hammer icon) runs `latexmk` and exposes the build log.
- **Compile & Preview** becomes **Stop** while this folder's build or preview is
  active. Stop cancels an ongoing build or transfer and stops future updates,
  retaining the previous local PDF and leaving the viewer open.
- **Preview** opens an existing PDF without compiling and checks for updates every
  three seconds. A changed PDF is downloaded in full and atomically replaces the
  same local file. An interrupted or incomplete download keeps the previous PDF.
- The **refresh icon** checks immediately. The primary **Stop** button ends activity;
  there is no separate stop control.
  Icon controls have hover labels.
- **Build settings** contains the engine selector and an optional custom PDF
  path such as
  `build/slides.pdf`. The compiler's output location remains controlled by your
  LaTeX project configuration.

Your viewer provides zoom, text selection, search and links. Its automatic reload
behavior determines how it responds when the local PDF is replaced. SyncTeX
editor integration is not included.

## Requirements and access

Tested with Herdr 0.1.12 on Linux. The code also selects macOS's `open` launcher,
but macOS has not been tested. Windows is not supported.

- **Local computer:** Python 3.11+, `hc`, a PDF viewer, and `xdg-open` on Linux
  or `open` on macOS.
- **Machine doing the build:** Python 3.11+, `latexmk`, and the selected engine
  (`pdflatex`, `lualatex` or `xelatex`).
- **Remote work:** a connected machine in Herdr. Discovery, compilation, metadata
  checks and binary PDF transfers all use that existing connection through
  `hc exec --on`. The mod does not start SSH or need a separate SSH-agent setup.
- **Optional:** Git speeds up discovery and respects project ignore rules.

This is trusted mod code. It reads TeX sources and PDFs in your working folder,
runs commands and transfers through `hc`, writes a temporary
local PDF, and launches your default viewer. LaTeX builds can also execute the
project's existing `latexmk` configuration. It does not store SSH passwords or
upload your documents to a service.

Builds are limited to ten minutes. Preview helpers survive panel closure and stop
after twelve hours without a button action. PDF downloads are limited to 250 MiB.
PDFs are transferred as exact binary 4 MiB chunks, below Herdr's 8 MiB per-command
output limit. Discovery uses Git's tracked and untracked file lists when available,
respecting ignore rules. Outside Git, a Python scan follows directory symlinks
safely and skips hidden, cache, dependency and build folders. Searches report
partial results at 2,000 matches or 10,000 directories, with a two-second fallback
budget or up to three seconds for Git discovery.
Narrow the filename filter or `cd` into a more specific directory when needed.

Session files and build logs live under the installed mod's `.runtime/` directory.
The local PDF lives in a private OS temporary directory. Runtime files and Herdr's
installed generated typings are excluded from this repository. Development API snapshots are versioned under `types/`.

## Development

Install [uv](https://docs.astral.sh/uv/), [just](https://just.systems/), Python
3.11+ and Node 22.15+ (Node 24 recommended). The Python integration tests also
require `latexmk`, `pdflatex` and `pdfinfo` (`latexmk texlive-latex-base poppler-utils`
on Debian/Ubuntu).

```sh
just setup       # install locked development dependencies
just check       # formatting, Ruff, strict mypy, strict JS types, Python + JS tests
just format      # apply formatting and safe Ruff fixes
just coverage    # Python coverage report
just check-native # validate native rendering with an installed Herdr app
```

CI runs `just check`, including real LaTeX compilation and background-worker
integration tests. No development packages are required by the installed mod.

All Python source and tests use strict mypy. Ruff checks imports and code, and
Ruff/Prettier enforce formatting. The native JavaScript stays directly executable
by Herdr: JSDoc and shared domain declarations provide strict TypeScript `checkJs`
checking without a build step. JSON boundaries validate unknown data at runtime.
API snapshots and their refresh procedure are documented in [types/README.md](types/README.md).

The Node tests import production modules through a small native API mock and
exercise context changes, stale async responses, Stop controls, toolbar activity,
and navigation. Python tests cover JSON validation, safe discovery, binary PDF
transfers, incomplete replacement recovery, real compilation, background workers,
upgrades, and cancellation. Herdr's native check and a visual smoke test are still
needed after UI changes because mocks do not lay out GPUI elements.

The source is grouped by responsibility:

```text
mods/latex/
  main.js             panel state, commands, discovery and preview lifecycle
  session.js          current folder, identity and saved project preferences
  helper-client.js    helper requests and status-file reads
  model.js            runtime JSON validation and shared state access
  contracts.d.ts      domain types shared by frontend modules
  toolbar-button.js   activity indicator and opening the panel
  session-picker.js   open-here / go-to-preview navigation
  ui/                 panel shell, controls, documents, settings, activity, footer
  helper.py           local supervisor, cancellation and PDF transfer
  remote.py           standalone script sent over the Herdr connection
  tests/              Python and frontend regression tests
```

Rendering functions in `ui/` receive the panel controller; they use its actions
rather than owning a second copy of session or worker state. They create native
GPUI elements, so there is still no build step or web view.

Keep the whole runtime tree when installing, including `ui/` and both Python
files. `remote.py` stays self-contained because the remote machine receives its
source as a single script; splitting it would require remote dependency deployment.
The SVG icons live in `mods/latex/icons/`. `scripts/toolbar_bundle.py` copies the
launcher's shared modules together without rewriting imports. After changing
those modules, regenerate the installed toolbar bundle too.
