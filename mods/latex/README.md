# LaTeX panel

Focus your project folder in Herdr and click **LaTeX**, or run:

```sh
herdr-app do mod.open --name latex
```

The panel follows the current session's machine and folder. Change projects with
Herdr's navigation or `cd` in the terminal. Document and build settings are
remembered per machine and folder.

## Documents and builds

Click the document card to choose a file. Main documents appear first; **Show
included files** reveals the others. Enter a filename filter and press Search or
Enter to search again. If results are incomplete, narrow the filter or navigate
to a smaller folder. Home directories and broad system folders are not searched;
you can still enter an explicit file path.

- **Compile & Preview** builds the selected document and opens the PDF after
  success. It becomes **Stop** while this folder's build or preview is active.
- **Compile only** (hammer icon) builds without opening the viewer. Failed builds
  expand the log; you can also open the log manually.
- **Preview** opens an existing PDF and watches for updates.
- **Stop** cancels the build or transfer and ends preview updates. The last local
  PDF and its viewer remain open.
- **Build settings** selects the engine and an optional PDF output path. By
  default, the PDF is next to the selected TeX file. Relative overrides resolve
  against the current project folder; they do not change compiler output options.

The toolbar is green with ▶ when this folder has an active build or preview.
A green dot means activity is elsewhere; clicking offers **Open LaTeX here** or
**Go to active preview**. Opening here leaves the other preview running; starting
a new build or preview replaces the previous managed activity.

## Preview updates and limits

Preview continues when the panel closes and detects external rebuilds, including
those started by agents. An incomplete PDF, interrupted transfer, or temporary
connection failure retains the last complete copy and retries automatically.
Use the refresh icon to check immediately. Reopen the panel to inspect status or
stop updates. If your viewer does not reload changed files, reopen the preview.

Builds have a ten-minute limit, previews expire after twelve hours without a
button action, and PDFs are limited to 250 MiB. Local preview files are temporary;
keep the original PDF in your project. Zoom, search, links, and text selection
are supplied by your viewer. SyncTeX editor integration is not supported.

Requirements, installation, and development instructions are in the
[project repository](https://github.com/paperbenni/herdr-latex).

Licensed under GNU GPL version 2 only (`GPL-2.0-only`); see [LICENSE](LICENSE).
