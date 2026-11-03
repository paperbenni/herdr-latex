# Herdr LaTeX

A native LaTeX panel that follows the current Herdr session. Choose a document,
compile on that session's machine, and open an automatically refreshed temporary
PDF in the local desktop viewer. Add a LaTeX toolbar button during installation.

![Herdr LaTeX](preview.png)

## What you see

- A 620 by 660 logical-pixel overlay with a fixed header, scrolling body and fixed
  action footer. Its colors follow Herdr's theme. The title is 20 px; controls
  use 12 px text, and secondary labels use 10–11 px.
- A compact read-only machine and working-directory breadcrumb. Its tooltip shows
  the full path. There is no separate
  machine, project or folder selector.
- A prominent selected-document card with a document icon, 15 px filename and
  muted parent path. Click it to expand the file picker; choosing a file collapses
  the picker. Main documents containing `\documentclass` are shown first; a link
  reveals included files. A manual path input is revealed only when requested.
- Filename filtering appears for longer lists or partial searches, with a search
  icon button. Incomplete scan and unreadable folder notices are concise, with
  fuller details available in tooltips.
- A collapsed **Build settings** row, showing the current engine. Expanding it
  reveals PDFLaTeX, LuaLaTeX and XeLaTeX choices and an optional PDF output override.
- A compact build/preview status section appears only when relevant to this
  folder. It includes a refresh icon and a collapsible monospace build log.
  Errors expand the log automatically.
- The footer has one wide **Compile & Preview** primary button, a secondary
  **Preview** button and a hammer icon for **Compile only**. These remain visible
  while scrolling. Icon controls have hover labels and accessibility labels.
  Buttons requiring a document are disabled until one is selected, and build
  buttons are disabled while that build runs.
  The primary button becomes **Stop** while a build or preview belongs to this
  folder. Show **Stopping…** until cancellation completes, then restore the start
  action. Do not show a duplicate stop icon elsewhere in the panel.
- The toolbar's LaTeX button turns green (`#15803d`, white text) with ▶ only when
  activity belongs to the current machine/folder. Activity elsewhere gets a small
  green dot on the neutral button. Clicking it offers **Open LaTeX here** and
  **Go to active preview**, each labelled with its machine and folder. In a
  collapsed sidebar the current-folder active button shows just ▶.

## How it behaves

Opening the panel searches the current session's live working directory. Focusing
another session or changing its directory updates the source and starts a fresh
search. Prefer the focused terminal's live cwd; fall back to a live pane in the
active tab, then the space folder. Do not take the first terminal in the space:
different tabs may be in different repositories.

Before enumerating anything or invoking Git, skip the machine's actual home
directory, its ancestors and common system/temporary roots. Resolve symlinks and
compare filesystem identities to catch aliases. Return a normal skipped response
with zero visited directories; show an **Open a project folder** empty state,
disable rescan there, and keep manual file-path entry available. Filename filters
and home-directory Git repositories must not bypass this guard. Exclude links
back to these broad directories when traversing a project as well. A project
subfolder inside home is still eligible for normal discovery.

Remember document, engine and PDF output per machine and folder. Automatically
select a main document if exactly one is found. Clicking a file selects it without
hiding the other results. Typing filters loaded results immediately; Search or
Enter scans the folder using that filename/path filter. Rescan explicitly refreshes
the list. Discard results that arrive after the source changed.

Compile runs `latexmk` on the selected session's machine, changes into the source
file's directory, emits synchronization data, and records the build output.
**Compile & Preview** starts the viewer only after a successful build. Failed
builds show their exit state and expand the log; never open an older PDF as if
that failed build succeeded.

Preview downloads an existing PDF into a private temporary directory, opens the
stable local path with the OS viewer, and checks upstream metadata every three
seconds. Changed PDFs are downloaded to a partial file, checked for stability and
PDF markers, and atomically replace the local copy. Unchanged files are not
transferred. Missing PDFs or broken connections retain the previous local copy
and retry. The primary Stop action ends polling and cancels an in-progress build
or transfer, retaining the last PDF and leaving the viewer open. Use process-group
termination and stop checks while waiting on core requests, so cancellation is
prompt even if a transfer or command is blocked. Never open the viewer after a
cancelled build. Refresh checks now.

Helpers continue when the overlay closes or reloads, for at most twelve hours
without a button action. Idle helpers stop after ten minutes. Show which source
an existing preview belongs to if the current session has changed. Builds and
preview status are independent of agent working/blocked/done/idle states; this
panel does not draw an agent list or animate those states.

## Built from

Install only `mods/latex/` from this repository. It contains a GPUI `View` in
`main.js`, standard-library Python helpers in `helper.py` and `remote.py`, a `mod.json` with
`place: none`, keyboard focus opt-in and 620×660 overlay dimensions, usage notes,
and regression tests. Small monochrome SVG icons live under `icons/` and are
rendered using GPUI's tinted `svg()` builder. Do not install generated typings,
bytecode or `.runtime`.

Use `gpui-kit`'s View/div and `gpui-base`'s flex builders and InputState/Input.
Herdr APIs used include `focused`, `spaces`, `panes`, `shared`/`setShared`,
`readTextFile`, `exec`, `nextCommand`, `appHome`, `home`, and `theme`. Live context
changes cause renders; defer input changes out of render rather than polling
Herdr's live model. A two-second timer reads helper status, not session data.

The Python CLI uses `hc exec --on` for every remote operation over Herdr's existing
machine connection. Compilation has a 600-second limit; discovery has an
eight-second core timeout around its shorter internal scan budget. PDF downloads
use exact binary chunks of at most 4 MiB, below the core's 8 MiB stdout limit;
validate every chunk length and upstream file metadata before replacing the local
file. Local work uses Python subprocesses directly. A worker
per configuration uses an exclusive file lock, a JSON request queue, atomically
written status, and an upgrade marker so idle workers can load new helper code.
Viewer launch uses `xdg-open` on Linux or `open` on macOS.

For a visible **LaTeX** button with an activity indicator, copy
`mods/latex/toolbar-button.js` into the person's cloned/personal toolbar mod as
`latex-button.js`. Also copy `model.js` as `latex-model.js` into that toolbar
mod and change the button's import from `"./model.js"` to `"./latex-model.js"`.
Copy `contracts.d.ts` there for editor typing (runtime does not load it).
Then integrate its native View:

```js
import LatexToolbarButton, { latexButtonContext } from "./latex-button.js";

// In the toolbar View's init method:
const context = latexButtonContext();
this.latexContext = JSON.stringify(context);
this.latexButton = cx.new(LatexToolbarButton, context);

// In render(cx), subscribe to context changes and defer child updates:
const context = latexButtonContext();
const key = JSON.stringify(context);
if (key !== this.latexContext) {
  this.latexContext = key;
  cx.spawn(async cx => {
    await cx.sleep(0);
    if (this.latexContext === key) this.latexButton.set_props(context);
  });
}
toolbar.child(this.latexButton);
```

Clone shipped layouts and toolbar mods before editing. Preserve existing personal
layout changes. In Herdr's default layout, the `brand` block's `workspace-chrome`
mod draws the upper-left toolbar; clone that mod, add a text button, and reference
the clone from a personal layout. Preserve existing init logic and do not create
an unused button instance for a footer-only copy of the toolbar. The component
stops mouse-down propagation so clicking does not drag the window. It reads
`latex.status-file` and polls helper status every two seconds; builds and preview
watchers count as active only with a live PID field and a heartbeat less than
180 seconds old. If the panel has not yet published a status-file pointer, it can
look up the existing `latex.active-session` through the helper's status command.
It keeps working while the panel is closed. Parent context forwarding is important
for a retained nested view: it makes the button respond to live focus changes
without polling Herdr's model. `session-picker.js` implements the compact choice
popup; its jump action selects an existing matching pane on the correct machine,
or creates a tab at the preview folder if that pane no longer exists. Opening the
current folder preserves focus and does not stop the background preview. Starting
a new build/preview explicitly replaces the previous managed activity.
`mod.open` toggles the overlay. There is no bundled
layout or keybinding to replace the person's setup. Include the mod's SVG icons
when copying it.

## Watch out

- This code runs programs, reads project files and uses Herdr's remote connection.
  Tell the person before installing, as Herdr's mod guide requires.
- Unix hosts only. Local Python uses `fcntl`; Windows is unsupported. macOS's
  launcher is implemented but has not been tested.
- Herdr 0.1.12 is the tested API version. Read the installed type declarations if
  native builders differ on another version.
- The machine needs Python 3.11+, `latexmk` and the chosen engine on its PATH. The
  local desktop also needs Python 3.11+, `hc`, an OS opener and a PDF viewer.
- Reuse Herdr's configured connection; do not resolve an SSH target or launch a
  separate SSH connection. The mod must work without SSH-agent environment variables.
- Git discovery includes tracked and untracked TeX files and respects ignored
  paths. Git is optional. Outside Git, Python scans have no depth limit, guard
  against symlink cycles, and skip hidden, cache, dependency and build directories.
  Report limits of 2,000 matches, 10,000 directories, two seconds for fallback
  traversal or up to three seconds for Git discovery. Filtering starts a new remote
  search and is not restricted to a truncated result prefix.
- The optional PDF override changes the downloaded file, not compiler flags.
  Relative PDF overrides are relative to the current working directory; the
  default is next to the selected TeX file.
- Updates download the entire changed PDF; there is no block-level rsync.
  Downloads are limited to 250 MiB. Viewer auto-reload is viewer-dependent.
- Text selection, search, links and zoom are supplied by the external viewer.
  SyncTeX editor integration is not implemented.
- Native mod checks do not exercise all later async states. Also open the panel
  and inspect search results, errors, a build, and preview updates in Herdr.

## Done when

1. The toolbar button opens and closes the panel with one click.
   It turns green with ▶ only in the active machine/folder. Elsewhere it is neutral
   and offers opening here or jumping to the active preview. Both choices preserve
   the intended folder, and the green state clears when activity stops or goes stale.
2. A focused remote terminal sets the correct machine and live cwd, even if its
   space was originally created elsewhere; switching session or `cd` updates it.
3. A project with `paper/main.tex` and `slides/slides.tex` lists both main documents,
   supports filename filtering, and reports any truncation.
4. A real temporary LaTeX project builds successfully, while a broken project
   reports failure and does not launch a preview through Compile & Preview.
5. Preview opens a temporary local path; a later upstream edit updates that same
   local path. An incomplete or interrupted replacement keeps the previous PDF.
6. The primary action becomes Stop during activity; it cancels a running build or
   transfer and stops polling without closing the viewer. Closing/reopening the
   panel can still control its helper. No duplicate stop control is shown.
7. `herdr-app check mods/latex`, the Python suite and the Node context tests pass.


## Developer checks

Use `just setup` once, then `just check` for Ruff, formatting, strict Python and
JavaScript typing, and both test suites. `just check-native` validates native
rendering separately. See the repository README for dependencies and API snapshots.
