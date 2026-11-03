# Herdr LaTeX

Compile LaTeX in your current [Herdr](https://herdr.dev) session and preview an
automatically updated local PDF in your desktop viewer. Local and remote projects
use the same panel; remote work uses Herdr's existing connection.

![LaTeX panel with an active remote preview and a Stop button](preview.png)

## Install

Ask your Herdr coding agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then install
https://github.com/paperbenni/herdr-latex using its RECIPE.md.
Add a LaTeX button to my current toolbar, preserving my existing customizations.
```

For manual installation and toolbar integration, see [RECIPE.md](RECIPE.md).
No Node packages or build step are needed to run the installed mod.

## Use

1. Focus your project folder in Herdr and click **LaTeX**.
2. Choose the main document, then click **Compile & Preview**.
3. The PDF opens in your desktop viewer. The primary button becomes **Stop** while
   this folder has an active build or preview.

The panel follows the current session's machine and folder. It remembers your
document and build settings per project. Previews keep updating when another
program or agent rebuilds the PDF, including while the panel is closed.

The toolbar turns green with ▶ for activity in the current folder. A green dot
indicates activity elsewhere; click it to open here or jump to that project.

See the [user guide](mods/latex/README.md) for controls, PDF output settings,
recovery behavior, and limitations.

## Requirements

- **Local computer:** Python 3.11+, Herdr's `hc`, a PDF viewer, and `xdg-open`
  on Linux or `open` on macOS.
- **Build machine:** Python 3.11+, `latexmk`, and the selected engine:
  PDFLaTeX, LuaLaTeX, or XeLaTeX.
- **Remote projects:** a connected machine in Herdr. No separate SSH or SSH-agent
  setup is needed.
- **Optional:** Git improves document discovery and respects project ignore rules.

Tested with Herdr 0.1.12 on Linux. macOS support is implemented but untested;
Windows is unsupported. Viewer auto-reload depends on your PDF application.
SyncTeX editor integration is not included.

The mod reads project files, runs LaTeX on the selected machine, downloads a
temporary PDF, and launches your viewer. Builds use your project's existing
`latexmk` configuration. Documents are not uploaded to a separate service.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and a code overview.
