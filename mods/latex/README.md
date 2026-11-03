# LaTeX panel

After installation, use your LaTeX toolbar button, or:

```sh
herdr-app do mod.open --name latex
```

The reusable `toolbar-button.js` View turns green with ▶ for activity in the
current folder. Elsewhere it stays neutral with a green dot; clicking offers
**Open LaTeX here** or **Go to active preview**. See RECIPE.md for integration,
including forwarding `latexButtonContext()` from the parent toolbar.

The panel follows the current Herdr session's machine and live working directory.
Switch sessions or `cd` in the terminal to change folders. The current machine
and folder appear as a read-only label; there is no separate project selector.
Main document, engine and PDF output preferences are remembered per machine and
folder. The folder is searched automatically on opening and after context changes.
Home directories, their ancestors and common system/temporary roots are excluded
from discovery. Navigate to a project directory in Herdr instead. Explicit file
paths can still be entered without scanning; broad folders aren't searched even
with a filename filter or a Git repository present.
Click the document card to choose another file. Engine and PDF output options are
under **Build settings**. Icon controls have hover labels; build logs stay
collapsed until requested or a build fails.
**Rescan folder** uses Git's file list when available, respecting ignore rules
and including untracked TeX files. Otherwise it uses a bounded Python scan.
It recognizes main documents by `\documentclass` and shows those first. Toggle
**Show all TeX files** to see included chapter files. Type a filename/path filter
to filter results immediately; press **Search** or Enter to search the folder
again with that filter. Searches report partial results and unreadable folders.
They are bounded to 2,000 matches and 10,000 directories, with a two-second
fallback scan budget (up to three seconds for Git discovery). Fallback scans follow
directory links safely and skip hidden, dependency, cache and build folders.

**Compile** runs `latexmk`
on that machine using the selected engine, and shows its output. The build limit
is ten minutes. The directory of the TeX file is used by `latexmk -cd`.
**Compile & Preview** turns into **Stop** while this folder's build or preview is
active. Stop cancels builds, transfers and future updates while retaining the
last PDF and leaving the viewer open. It replaces the separate stop control.
**Compile & Preview** opens the PDF only after the build succeeds. Build errors
expand the log automatically. Action buttons stay visible while scrolling.

**Preview** downloads the existing PDF to a private temporary directory and opens
it with the local system viewer. It watches every three seconds, transfers the
whole PDF only after its metadata changes, checks for changes during transfer,
and atomically replaces the same local filename. **Stop** stops polling;
it does not close the viewer or delete the last PDF. Successful builds refresh a
running preview. To preview first, either compile or supply an existing PDF path.

An optional PDF output field overrides the default `.pdf` next to the main TeX
file. Relative output paths resolve against the project directory. It changes
which PDF is previewed, not latexmk's output options; project `.latexmkrc` files
continue to control the build.

Requirements: local Python 3.11+, `hc`, and `xdg-open` (Linux) or `open` (macOS).
The selected machine needs Python 3.11+ and `latexmk` plus the chosen TeX engine.
Discovery, builds and PDF transfers use the existing Herdr connection through
`hc exec --on`. The mod does not launch SSH or require an SSH-agent environment.
Downloads use 4 MiB binary chunks below Herdr's output limit, then atomically
replace the local PDF. Git is an optional discovery optimization.

The helper survives panel closure/reload. Preview sessions stop after twelve
hours without a button action; idle helpers exit after ten minutes. The local
PDF remains in the OS temporary directory for normal system cleanup. Build logs,
session configuration and status live under `.runtime/`. This is a custom mod;
Herdr updates do not replace it. Only Unix remotes are supported by this version.

Viewer auto-reload depends on the local application. Text selection, search,
links and zoom belong to that viewer. SyncTeX editor integration is not included.

Validation:

```sh
herdr-app check ~/.config/herdr-app/mods/latex
python3 -m unittest discover -s ~/.config/herdr-app/mods/latex/tests
node --test ~/.config/herdr-app/mods/latex/tests/test_context.cjs
node --test ~/.config/herdr-app/mods/latex/tests/test_toolbar.cjs
node --test ~/.config/herdr-app/mods/latex/tests/test_session_picker.cjs
```
