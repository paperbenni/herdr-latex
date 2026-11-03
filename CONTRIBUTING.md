# Contributing

## Setup and checks

Use Python 3.11+, Node 22.15+, [uv](https://docs.astral.sh/uv/), and
[just](https://just.systems/). Integration tests also need `latexmk`, `pdflatex`,
and `pdfinfo` (`latexmk texlive-latex-base poppler-utils` on Debian/Ubuntu).

```sh
just setup        # install locked development dependencies
just check        # Ruff, formatting, strict typing, Python and frontend tests
just format       # apply formatting and safe lint fixes
just coverage     # Python coverage report
just check-native # validate the panel with an installed Herdr app
```

CI runs `just check`. The installed mod uses no third-party Python packages and
does not need Node. JavaScript stays directly executable in Herdr; JSDoc and
TypeScript's `checkJs` provide strict typing without a build step. Python source
and tests use strict mypy. See [types/README.md](types/README.md) for the native API
snapshots and how to refresh them.

## Code overview

Within `mods/latex/`:

- `main.js` owns panel state and actions; `ui/` renders its sections and controls.
- `session.js` shares folder resolution and preferences between panel and toolbar.
- `helper-client.js` handles helper requests; `model.js` validates frontend data;
  `contracts.d.ts` defines domain types.
- `toolbar-button.js` and `session-picker.js` handle opening and navigation.
- `helper.py` supervises builds, cancellation, and PDF transfers. `remote.py` is
  a standalone script sent over Herdr's connection; keep it independently
  executable so remotes need only Python and their LaTeX tools.
- `tests/` covers behavior, including external rebuilds and recovery. Native API
  mocks live under the repository's `tests/` directory.

State files, shared keys, helper commands, timing, and transfer details are
internal implementation choices, not supported integration interfaces. Use the
panel, `herdr-app do mod.open --name latex`, or the toolbar integration described
in [RECIPE.md](RECIPE.md).

After UI changes, run the native check and inspect the panel in Herdr; mocks do
not lay out GPUI elements or exercise every asynchronous native state. Check a
project, an empty or excluded folder, settings, errors, and preview controls.
When updating an installed copy, deploy the whole runtime tree and regenerate
its toolbar bundle. Follow [RECIPE.md](RECIPE.md) to preserve personal settings.
