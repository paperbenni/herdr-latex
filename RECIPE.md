# Install Herdr LaTeX

Read the installed `~/.config/herdr-app/AGENTS.md` first. This mod runs LaTeX on
the selected machine, downloads a temporary PDF, and opens the local viewer;
explain that access when installing. Requirements and supported platforms are in
[README.md](README.md).

## Panel

Copy the complete `mods/latex/` runtime tree to
`~/.config/herdr-app/mods/latex/`, including its JavaScript modules, `ui/`, icons,
`helper.py`, and `remote.py`. Tests, generated declarations, caches, and runtime
state need not be copied. Keep `contracts.d.ts` for editor typing if desired.

Inspect an existing installation before updating it. Preserve local
customizations and its `.runtime/` directory. Do not install the repository's
`types/` development snapshots into Herdr.

```sh
herdr-app check ~/.config/herdr-app/mods/latex
herdr-app do mod.open --name latex
```

## Toolbar button

Clone shipped layouts and toolbar mods before editing; preserve the person's
existing layout. In Herdr's default layout, `workspace-chrome` draws the toolbar.
Install the button into the corresponding personal mod and point the personal
layout at that mod.

From the repository, copy the launcher bundle:

```sh
just toolbar-bundle ~/.config/herdr-app/mods/my-toolbar/latex
```

Without development tools, copy `LICENSE`, `toolbar-button.js`, `session.js`,
`helper-client.js`, `model.js`, and `contracts.d.ts` into that toolbar's `latex/`
subfolder. Keep their filenames and relative imports intact. Refresh this bundle
when updating the panel.

```js
import LatexToolbarButton, { latexButtonContext } from "./latex/toolbar-button.js";

// Add to the toolbar's init, preserving its existing logic:
const context = latexButtonContext();
this.latexContext = JSON.stringify(context);
this.latexButton = cx.new(LatexToolbarButton, context);

// In render(cx), forward live context changes to the retained child:
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

Mount the child only in the toolbar instance that displays it. For older installs
using a renamed `latex-button.js`, update the parent import to the bundle path
above. The bundle command copies files; it does not edit the parent View or layout.

## Verify

Run `herdr-app check` on both the panel and personal toolbar mod, then try the
button in Herdr. Check that the panel follows the current folder, a real document
builds and previews, and Stop ends updates. With a preview active elsewhere,
verify both **Open LaTeX here** and **Go to active preview**.

User controls are documented in [the user guide](mods/latex/README.md). Developer
checks are in [CONTRIBUTING.md](CONTRIBUTING.md).
