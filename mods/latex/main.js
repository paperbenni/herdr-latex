import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  appHome,
  closeOverlay,
  exec,
  focused,
  home,
  nextCommand,
  panes,
  props,
  readTextFile,
  shared,
  setShared,
  spaces,
} from "herdr";
import LatexSessionPicker from "./session-picker.js";
import {
  activeSession,
  savedProjects,
  readActionReply,
  readStatusReply,
  readStatus,
  readDiscovery,
  readPickerOptions,
  isRecord,
  palette,
} from "./model.js";

/** @type {ReadonlyArray<readonly [import("./contracts.js").Engine, string]>} */
const ENGINES = [
  ["pdflatex", "PDFLaTeX"],
  ["lualatex", "LuaLaTeX"],
  ["xelatex", "XeLaTeX"],
];
/** @param {import("./contracts.js").Source} c */
const sourceKey = (c) => JSON.stringify([c.machine || "", c.folder]);
/** @param {import("./contracts.js").Config} c */
const configKey = (c) =>
  JSON.stringify([c.machine || "", c.folder, c.tex, c.pdf, c.engine]);

/** @returns {import("./contracts.js").Source} */
function context() {
  const f = focused();
  const space = spaces().find((s) => s.id === f?.space);
  const machine = space?.machine || "";
  const tab =
    space?.tabs.find((t) => t.id === f?.tab) ||
    space?.tabs.find((t) => t.active);
  const live = panes().find((p) => p.tab === tab?.id && p.cwd);
  return {
    machine,
    folder: f?.cwd || live?.cwd || space?.folder || (machine ? "~" : home()),
  };
}

export default class Latex extends View {
  /** @type {import("./contracts.js").Source} */ source;
  /** @type {import("./contracts.js").Config} */ active;
  /** @type {import("./contracts.js").Engine} */ engine;
  /** @type {Record<import("./contracts.js").InputKey, import("gpui-base").InputState>} */ inputs;
  /** @type {import("./contracts.js").Status} */ status = {};
  /** @type {import("./contracts.js").Discovery | null} */ files = null;
  /** @type {import("gpui-kit").FocusHandle} */ handle;
  /** @type {import("gpui-kit").Entity | undefined} */ sessionPicker;
  /** @type {string | undefined} */ statusFile;
  contextPending = false;
  choosing = true;
  stopPending = false;
  error = "";
  busy = false;
  finding = false;
  polling = false;
  mainsOnly = true;
  advanced = false;
  manualPath = false;
  showLog = false;
  generation = 0;
  /** @param {import("gpui-shell").Props | undefined} _props @param {import("gpui-kit").AsyncContext} cx */
  init(_props, cx) {
    const picker = readPickerOptions(props());
    if (picker) {
      this.sessionPicker = cx.new(LatexSessionPicker, picker);
      return;
    }
    const here = context();
    this.source = here;
    const previous = activeSession();
    /** @type {Partial<import("./contracts.js").Config>} */
    const saved =
      savedProjects()[sourceKey(here)] ||
      (previous && sourceKey(previous) === sourceKey(here) ? previous : {});
    /** @type {import("./contracts.js").Config} */
    const initial = { tex: "", pdf: "", engine: "pdflatex", ...saved, ...here };
    this.engine = initial.engine;
    this.inputs = {
      tex: InputState.new({
        value: initial.tex,
        placeholder: "Relative or absolute .tex path",
      }),
      pdf: InputState.new({
        value: initial.pdf,
        placeholder: "Automatic: PDF next to the main TeX file",
      }),
      search: InputState.new({ value: "", placeholder: "Find a document…" }),
    };
    this.generation = 0;
    for (const key of /** @type {const} */ (["tex", "pdf", "search"])) {
      this.inputs[key].on("change", (_e, cx) => {
        if (key !== "search") this.save();
        this.error = "";
        cx.notify();
      });
    }
    this.inputs.search.on("submit", (_e, cx) => this.discover(cx));
    this.active = activeSession() || this.config();
    this.status = {};
    this.files = null;
    this.error = "";
    this.busy = false;
    this.stopPending = false;
    this.finding = false;
    this.polling = false;
    this.mainsOnly = true;
    this.advanced = Boolean(initial.pdf);
    this.choosing = !initial.tex;
    this.manualPath = false;
    this.showLog = false;
    this.handle = cx.focus_handle();
    this.poll(cx);
    this.discover(cx);
    cx.timer.every(2000, (cx) => this.poll(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.inputs.tex.focus();
        if (
          command === "compile" ||
          command === "preview" ||
          command === "build-preview" ||
          command === "stop" ||
          command === "refresh"
        )
          this.act(command, cx);
        if (command === "find") this.discover(cx);
        cx.notify();
      }
    });
  }

  /** @returns {import("./contracts.js").Config} */
  config() {
    return {
      ...this.source,
      tex: this.inputs.tex.value().trim(),
      pdf: this.inputs.pdf.value().trim(),
      engine: this.engine,
    };
  }

  save() {
    const config = this.config();
    setShared("latex.folder-projects", {
      ...savedProjects(),
      [sourceKey(this.source)]: config,
    });
  }

  invalidateFiles() {
    this.files = null;
    this.generation++;
    this.finding = false;
  }

  /** @param {import("gpui-kit").Context} cx */
  followCurrent(cx) {
    const here = context();
    if (sourceKey(here) === sourceKey(this.source)) return;
    this.source = here;
    const previous = activeSession();
    /** @type {Partial<import("./contracts.js").Config>} */
    const saved =
      savedProjects()[sourceKey(here)] ||
      (previous && sourceKey(previous) === sourceKey(here) ? previous : {});
    this.engine = saved.engine || "pdflatex";
    for (const key of /** @type {const} */ (["tex", "pdf"]))
      this.inputs[key].set_value(saved[key] || "");
    this.inputs.search.set_value("");
    this.advanced = Boolean(saved.pdf);
    this.choosing = !saved.tex;
    this.manualPath = false;
    this.invalidateFiles();
    this.error = "";
    cx.notify();
    this.discover(cx);
  }

  /** @param {import("./contracts.js").HelperAction} action @param {import("./contracts.js").Config} config @param {string} [search] @returns {Promise<unknown>} */
  async helper(action, config, search = "") {
    const r = await exec("python3", [
      `${appHome()}/mods/latex/helper.py`,
      action,
      "--config",
      JSON.stringify(config),
      "--search",
      search,
    ]);
    /** @type {unknown} */
    let data;
    try {
      data = JSON.parse(r.stdout);
    } catch {
      throw new Error(
        r.stderr || r.stdout || "The LaTeX helper did not reply.",
      );
    }
    const error =
      isRecord(data) && typeof data.error === "string" ? data.error : "";
    if (r.code !== 0 || error)
      throw new Error(error || r.stderr || "LaTeX helper failed.");
    return data;
  }

  /** @param {import("gpui-kit").Context} cx */
  poll(cx) {
    if (this.polling) return;
    this.polling = true;
    const active = this.active;
    const statusFile = this.statusFile;
    cx.spawn(async (cx) => {
      try {
        /** @type {import("./contracts.js").Status} */
        let status;
        if (!statusFile) {
          const r = readStatusReply(await this.helper("status", active));
          if (active !== this.active) return;
          this.statusFile = r.status_file;
          if (shared("latex.status-file") !== r.status_file)
            setShared("latex.status-file", r.status_file);
          status = r.status;
        } else {
          const content = await readTextFile(statusFile);
          if (active !== this.active) return;
          status = content ? readStatus(JSON.parse(content)) : {};
        }
        if (status.pid && Date.now() / 1000 - (status.heartbeat || 0) > 180)
          status = {
            ...status,
            watching: false,
            building: false,
            phase: "Helper stopped responding. Try again.",
          };
        this.status = status;
        if (!status.building && !status.watching) this.stopPending = false;
        if (
          status.build_code !== undefined &&
          status.build_code !== null &&
          status.build_code !== 0
        )
          this.showLog = true;
      } catch (e) {
        this.error = String(e);
      } finally {
        this.polling = false;
        cx.notify();
      }
    });
  }

  /** @param {import("./contracts.js").WorkAction} action @param {import("gpui-kit").Context} cx */
  act(action, cx) {
    if (this.busy) return;
    this.followCurrent(cx);
    const config = ["stop", "refresh"].includes(action)
      ? this.active
      : this.config();
    if (
      !config.folder ||
      (["compile", "build-preview"].includes(action) && !config.tex) ||
      (action === "preview" && !config.tex && !config.pdf)
    ) {
      this.error =
        "Choose a main document first, or enter a PDF path under PDF output.";
      cx.notify();
      return;
    }
    const changed = configKey(config) !== configKey(this.active);
    this.busy = true;
    if (action === "stop") this.stopPending = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (changed && (this.status.watching || this.status.building))
          await this.helper("stop", this.active);
        const r = readActionReply(await this.helper(action, config));
        this.active = config;
        setShared("latex.active-session", config);
        this.statusFile = r.status_file;
        setShared("latex.status-file", r.status_file);
        const build = ["compile", "build-preview"].includes(action);
        this.status = {
          ...(changed ? {} : this.status),
          building: build || (!changed && this.status.building),
          phase: build
            ? "Starting build…"
            : action === "stop"
              ? "Stopping…"
              : "Fetching PDF…",
        };
        this.save();
      } catch (e) {
        this.stopPending = false;
        this.error = String(e);
      }
      this.busy = false;
      cx.notify();
      this.poll(cx);
    });
  }

  /** @param {import("gpui-kit").Context} cx */
  discover(cx) {
    if (this.finding) return;
    if (!this.config().folder) {
      this.error = "Enter a project folder first.";
      cx.notify();
      return;
    }
    this.finding = true;
    this.error = "";
    const generation = ++this.generation;
    const config = this.config();
    const search = this.inputs.search.value().trim();
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = readDiscovery(
          await this.helper("discover", config, search),
        );
        if (
          generation !== this.generation ||
          sourceKey(config) !== sourceKey(this.config())
        )
          return;
        this.files = result;
        if (result.skipped) this.choosing = true;
        const mains = result.files.filter((f) => f.main);
        if (
          !this.inputs.tex.value() &&
          mains.length === 1 &&
          !result.truncated
        ) {
          this.inputs.tex.set_value(mains[0].path);
          this.choosing = false;
          this.save();
        }
      } catch (e) {
        if (generation === this.generation) this.error = String(e);
      } finally {
        if (generation === this.generation) this.finding = false;
        cx.notify();
      }
    });
  }

  /** @param {import("gpui-kit").Context} cx @returns {import("gpui-kit").NativeElement | import("gpui-kit").Entity} */
  render(cx) {
    if (this.sessionPicker) return this.sessionPicker;
    // Herdr re-renders on live context changes. Defer input updates out of render.
    if (
      sourceKey(context()) !== sourceKey(this.source) &&
      !this.contextPending
    ) {
      this.contextPending = true;
      cx.spawn(async (cx) => {
        await cx.sleep(0);
        this.contextPending = false;
        this.followCurrent(cx);
      });
    }
    const t = palette();
    const rawProps = props();
    const overlay =
      isRecord(rawProps) && typeof rawProps.overlay === "string"
        ? rawProps.overlay
        : null;
    const st = this.status;
    const config = this.config();
    const same = configKey(config) === configKey(this.active);
    const sessionHere = sourceKey(config) === sourceKey(this.active);
    const running =
      sessionHere && Boolean(st.building || st.watching || this.stopPending);
    const failed =
      st.build_code !== undefined &&
      st.build_code !== null &&
      st.build_code !== 0;
    /** @param {string} name @param {number} [size] */
    const icon = (name, size = 16) =>
      svg(`mods/latex/icons/${name}.svg`).size(size).flex_none();
    /** @param {string} id @param {string} text @param {string} symbol @param {(cx: import("gpui-kit").Context) => void} action @param {boolean} [primary] @param {boolean} [disabled] */
    const button = (
      id,
      text,
      symbol,
      action,
      primary = false,
      disabled = false,
    ) =>
      h_flex()
        .id(id)
        .h(primary ? 40 : 36)
        .px(13)
        .gap(7)
        .items_center()
        .justify_center()
        .rounded(8)
        .bg(primary ? t.solid : t.raised)
        .border(1)
        .border_color(primary ? t.solid : t.border)
        .text_color(primary ? t.solid_foreground : t.foreground)
        .text_size(12)
        .font_medium()
        .when(disabled, (el) => el.opacity(0.4))
        .when(!disabled, (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.opacity(0.85))
            .on_click((_e, cx) => action(cx)),
        )
        .when(Boolean(symbol), (el) => el.child(icon(symbol, 15)))
        .when(Boolean(text), (el) => el.child(text));
    /** @param {string} id @param {string} symbol @param {string} title @param {(cx: import("gpui-kit").Context) => void} action @param {boolean} [disabled] */
    const iconButton = (id, symbol, title, action, disabled = false) =>
      button(id, "", symbol, action, false, disabled)
        .w(36)
        .px(0)
        .tooltip(title)
        .accessibility_label(title);
    /** @param {string} id @param {string} text @param {(cx: import("gpui-kit").Context) => void} action */
    const link = (id, text, action) =>
      div()
        .id(id)
        .text_size(11)
        .text_color(t.muted)
        .cursor_pointer()
        .hover((s) => s.text_color(t.accent))
        .on_click((_e, cx) => action(cx))
        .child(text);
    /** @param {import("./contracts.js").InputKey} key */
    const input = (key) =>
      Input.new(this.inputs[key])
        .flex_none()
        .h(36)
        .px(11)
        .rounded(7)
        .border(1)
        .border_color(t.input)
        .bg(t.background)
        .text_color(t.foreground)
        .text_size(12);
    /** @param {string | undefined} path */
    const basename = (path) =>
      path?.replace(/\\/g, "/").split("/").pop() || "Choose a document";
    /** @param {string | undefined} path */
    const directory = (path) =>
      path?.replace(/\\/g, "/").split("/").slice(0, -1).join("/") || "";
    const folderLabel =
      !config.machine && config.folder === home()
        ? "Home"
        : config.folder
            .replace(/\/$/, "")
            .split("/")
            .filter(Boolean)
            .slice(-2)
            .join("/") || config.folder;
    const needle = this.inputs.search.value().trim().toLowerCase();
    const allFiles = this.files?.files || [];
    const mainCount = allFiles.filter((f) => f.main).length;
    const visible = allFiles.filter(
      (f) =>
        (!this.mainsOnly || !mainCount || needle || f.main) &&
        f.path.toLowerCase().includes(needle),
    );
    const choosing = this.choosing || !config.tex;
    const statusTitle = this.stopPending
      ? "Stopping…"
      : st.building
        ? "Compiling…"
        : st.watching
          ? st.error
            ? "Reconnecting preview"
            : "Live preview"
          : st.cancelled
            ? "Stopped"
            : failed
              ? "Build failed"
              : st.updated
                ? "Preview paused"
                : st.build_code === 0
                  ? "Build complete"
                  : "";
    const statusIcon = st.building
      ? "refresh"
      : st.error || failed
        ? "alert"
        : st.watching || st.build_code === 0
          ? "check"
          : "clock";
    const statusColor =
      st.error || failed ? t.blocked : st.watching ? "#4ade80" : t.muted;
    return v_flex()
      .id("latex-panel")
      .track_focus(this.handle)
      .size_full()
      .bg(t.surface)
      .text_color(t.foreground)
      .text_size(12)
      .child(
        h_flex()
          .flex_none()
          .px(22)
          .py(18)
          .gap(11)
          .items_center()
          .child(
            h_flex()
              .size(36)
              .rounded(10)
              .bg(t.raised)
              .text_color(t.accent)
              .items_center()
              .justify_center()
              .child(icon("document", 21)),
          )
          .child(div().flex_1().text_size(21).font_semibold().child("LaTeX"))
          .when(Boolean(overlay), (el) =>
            el.child(
              iconButton("latex-close", "close", "Close panel", () => {
                if (overlay) closeOverlay(overlay);
              })
                .w(28)
                .h(28)
                .bg(t.surface)
                .border(0)
                .text_color(t.muted),
            ),
          ),
      )
      .child(
        v_flex()
          .id("latex-content")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .child(
            v_flex()
              .flex_none()
              .px(22)
              .pb(20)
              .child(
                h_flex()
                  .gap(7)
                  .items_center()
                  .text_color(t.muted)
                  .text_size(11)
                  .when(Boolean(config.machine), (el) =>
                    el
                      .child(icon("server", 13))
                      .child(config.machine)
                      .child(div().text_color(t.dim).child("/")),
                  )
                  .child(icon("folder", 14))
                  .child(div().flex_1().min_w(0).truncate().child(folderLabel))
                  .tooltip(
                    `${config.machine || "This computer"}: ${config.folder}\nFollows the active Herdr session`,
                  ),
              )
              .when(Boolean(this.error), (el) =>
                el.child(
                  h_flex()
                    .mt(15)
                    .p(11)
                    .gap(8)
                    .rounded(8)
                    .bg(t.background)
                    .text_color(t.blocked)
                    .child(icon("alert"))
                    .child(div().flex_1().child(this.error)),
                ),
              )
              .child(
                h_flex()
                  .mt(24)
                  .mb(9)
                  .items_center()
                  .justify_between()
                  .child(div().text_size(13).font_semibold().child("Document"))
                  .child(
                    iconButton(
                      "latex-find",
                      "refresh",
                      this.files?.skipped
                        ? "Navigate to a project folder to find documents"
                        : this.finding
                          ? "Searching for documents…"
                          : "Rescan current folder",
                      (cx) => this.discover(cx),
                      this.finding || Boolean(this.files?.skipped),
                    ),
                  ),
              )
              .child(
                h_flex()
                  .id("latex-document-picker")
                  .p(13)
                  .gap(11)
                  .items_center()
                  .rounded(10)
                  .bg(t.background)
                  .border(1)
                  .border_color(choosing ? t.input : t.border)
                  .cursor_pointer()
                  .hover((s) => s.border_color(t.accent))
                  .on_click((_e, cx) => {
                    this.choosing = !choosing;
                    cx.notify();
                  })
                  .child(
                    div()
                      .text_color(config.tex ? t.accent : t.dim)
                      .child(icon("document", 22)),
                  )
                  .child(
                    v_flex()
                      .flex_1()
                      .min_w(0)
                      .gap(3)
                      .child(
                        div()
                          .text_size(15)
                          .font_semibold()
                          .truncate()
                          .child(basename(config.tex)),
                      )
                      .when(Boolean(directory(config.tex)), (el) =>
                        el.child(
                          div()
                            .text_size(11)
                            .text_color(t.muted)
                            .truncate()
                            .child(directory(config.tex)),
                        ),
                      ),
                  )
                  .child(div().text_color(t.dim).child(icon("chevron", 15))),
              )
              .when(choosing, (el) =>
                el.child(
                  v_flex()
                    .mt(9)
                    .gap(8)
                    .when(this.finding, (el) =>
                      el.child(
                        h_flex()
                          .py(9)
                          .gap(8)
                          .text_color(t.muted)
                          .child(icon("refresh", 14).spin(1400))
                          .child("Finding documents…"),
                      ),
                    )
                    .when(
                      allFiles.length > 5 ||
                        Boolean(needle) ||
                        Boolean(this.files?.truncated),
                      (el) =>
                        el.child(
                          h_flex()
                            .gap(6)
                            .child(
                              div().flex_1().min_w(0).child(input("search")),
                            )
                            .child(
                              iconButton(
                                "latex-search",
                                "search",
                                "Search filenames in the current folder",
                                (cx) => this.discover(cx),
                                this.finding,
                              ),
                            ),
                        ),
                    )
                    .when(Boolean(this.files), (el) =>
                      el.child(
                        v_flex()
                          .id("latex-files")
                          .max_h(210)
                          .overflow_y_scrollbar()
                          .gap(2)
                          .when(visible.length === 0 && !this.finding, (el) =>
                            el.child(
                              v_flex()
                                .p(10)
                                .gap(5)
                                .text_color(t.muted)
                                .child(
                                  div().child(
                                    this.files?.skipped
                                      ? "Open a project folder"
                                      : needle
                                        ? "No matching documents. Try another search."
                                        : "No TeX files in this folder.",
                                  ),
                                )
                                .when(Boolean(this.files?.skipped), (el) =>
                                  el.child(
                                    div()
                                      .text_size(11)
                                      .text_color(t.dim)
                                      .child(
                                        "Navigate with Herdr or cd in the terminal. Home and system folders aren't searched.",
                                      ),
                                  ),
                                ),
                            ),
                          )
                          .children(
                            visible.map((file) =>
                              h_flex()
                                .id(`tex-${file.path}`)
                                .px(11)
                                .py(10)
                                .gap(10)
                                .rounded(7)
                                .cursor_pointer()
                                .bg(
                                  file.path === config.tex
                                    ? t.selected
                                    : t.surface,
                                )
                                .hover((s) => s.bg(t.hover))
                                .child(
                                  div()
                                    .text_color(
                                      file.path === config.tex
                                        ? t.accent
                                        : t.dim,
                                    )
                                    .child(icon("document", 16)),
                                )
                                .child(
                                  v_flex()
                                    .flex_1()
                                    .min_w(0)
                                    .gap(2)
                                    .child(
                                      div()
                                        .font_medium()
                                        .truncate()
                                        .child(basename(file.path)),
                                    )
                                    .when(Boolean(directory(file.path)), (el) =>
                                      el.child(
                                        div()
                                          .text_size(10)
                                          .text_color(t.dim)
                                          .truncate()
                                          .child(directory(file.path)),
                                      ),
                                    ),
                                )
                                .when(file.path === config.tex, (el) =>
                                  el.child(
                                    div()
                                      .text_color(t.accent)
                                      .child(icon("check", 15)),
                                  ),
                                )
                                .on_click((_e, cx) => {
                                  this.inputs.tex.set_value(file.path);
                                  this.inputs.pdf.set_value("");
                                  this.choosing = false;
                                  this.save();
                                  cx.notify();
                                }),
                            ),
                          ),
                      ),
                    )
                    .child(
                      h_flex()
                        .px(2)
                        .justify_between()
                        .items_center()
                        .child(
                          link(
                            "latex-manual-path",
                            this.manualPath
                              ? "Hide path input"
                              : "Enter a file path",
                            (cx) => {
                              this.manualPath = !this.manualPath;
                              cx.notify();
                            },
                          ),
                        )
                        .when(
                          mainCount > 0 && allFiles.length > mainCount,
                          (el) =>
                            el.child(
                              link(
                                "latex-main-filter",
                                this.mainsOnly
                                  ? "Show included files"
                                  : "Main documents only",
                                (cx) => {
                                  this.mainsOnly = !this.mainsOnly;
                                  cx.notify();
                                },
                              ),
                            ),
                        ),
                    )
                    .when(this.manualPath, (el) => el.child(input("tex")))
                    .when(Boolean(this.files?.reason), (el) =>
                      el.child(
                        h_flex()
                          .gap(7)
                          .text_color(t.blocked)
                          .text_size(11)
                          .tooltip(this.files?.reason || "")
                          .child(icon("alert", 14))
                          .child(
                            div()
                              .flex_1()
                              .child(
                                "Search incomplete. Narrow the filename filter.",
                              ),
                          ),
                      ),
                    )
                    .when((this.files?.errors.length || 0) > 0, (el) =>
                      el.child(
                        div()
                          .text_size(11)
                          .text_color(t.blocked)
                          .tooltip((this.files?.errors || []).join("; "))
                          .child("Some folders could not be read."),
                      ),
                    ),
                ),
              )
              .child(
                h_flex()
                  .id("latex-advanced")
                  .mt(20)
                  .py(12)
                  .gap(8)
                  .items_center()
                  .border_t(1)
                  .border_color(t.border)
                  .cursor_pointer()
                  .text_color(t.muted)
                  .hover((s) => s.text_color(t.foreground))
                  .on_click((_e, cx) => {
                    this.advanced = !this.advanced;
                    cx.notify();
                  })
                  .child(icon("settings", 15))
                  .child(div().flex_1().child("Build settings"))
                  .child(
                    div()
                      .text_size(11)
                      .text_color(t.dim)
                      .child(
                        ENGINES.find(([key]) => key === this.engine)?.[1] ||
                          this.engine,
                      ),
                  )
                  .child(icon("chevron", 14)),
              )
              .when(this.advanced, (el) =>
                el.child(
                  v_flex()
                    .pb(8)
                    .gap(12)
                    .child(
                      h_flex()
                        .gap(5)
                        .flex_wrap()
                        .children(
                          ENGINES.map(([key, title]) =>
                            button(`engine-${key}`, title, "", (cx) => {
                              this.engine = key;
                              this.save();
                              cx.notify();
                            }).when(this.engine === key, (el) =>
                              el
                                .bg(t.selected)
                                .border_color(t.accent)
                                .text_color(t.accent),
                            ),
                          ),
                        ),
                    )
                    .child(
                      v_flex()
                        .gap(5)
                        .child(
                          div()
                            .text_size(11)
                            .text_color(t.muted)
                            .child("PDF to open"),
                        )
                        .child(
                          input("pdf").tooltip(
                            "Optional PDF override, relative to the current folder. Compiler output settings remain controlled by your project.",
                          ),
                        )
                        .child(
                          div()
                            .text_size(10)
                            .text_color(t.dim)
                            .child(
                              "Leave blank to use the PDF next to your TeX file.",
                            ),
                        ),
                    ),
                ),
              )
              .when(
                Boolean(
                  sessionHere && (statusTitle || st.error || st.build_log),
                ),
                (el) =>
                  el.child(
                    v_flex()
                      .mt(16)
                      .pt(16)
                      .gap(9)
                      .border_t(1)
                      .border_color(t.border)
                      .child(
                        h_flex()
                          .gap(8)
                          .items_center()
                          .child(
                            div()
                              .text_color(statusColor)
                              .child(
                                st.building
                                  ? icon(statusIcon, 16).spin(1400)
                                  : icon(statusIcon, 16),
                              ),
                          )
                          .child(
                            v_flex()
                              .flex_1()
                              .gap(3)
                              .child(
                                div()
                                  .font_medium()
                                  .child(statusTitle || "Preview"),
                              )
                              .when(Boolean(st.updated), (el) =>
                                el.child(
                                  div()
                                    .text_size(10)
                                    .text_color(t.dim)
                                    .child(
                                      `Updated ${new Date((st.updated || 0) * 1000).toLocaleTimeString()}`,
                                    ),
                                ),
                              ),
                          )
                          .when(Boolean(st.watching), (el) =>
                            el.child(
                              iconButton(
                                "latex-refresh",
                                "refresh",
                                "Refresh preview now",
                                (cx) => this.act("refresh", cx),
                                this.busy || this.stopPending,
                              ),
                            ),
                          ),
                      )
                      .when(
                        !same && Boolean(st.building || st.watching),
                        (el) =>
                          el.child(
                            div()
                              .text_size(11)
                              .text_color(t.muted)
                              .child(
                                `${this.active.machine || "This computer"} · ${this.active.tex || this.active.pdf}`,
                              ),
                          ),
                      )
                      .when(Boolean(st.error), (el) =>
                        el.child(
                          div()
                            .text_color(t.blocked)
                            .child(st.error || ""),
                        ),
                      )
                      .when(Boolean(st.build_log), (el) =>
                        el.child(
                          h_flex()
                            .gap(6)
                            .text_color(t.dim)
                            .child(icon("terminal", 13))
                            .child(
                              link(
                                "latex-toggle-log",
                                this.showLog
                                  ? "Hide build log"
                                  : "View build log",
                                (cx) => {
                                  this.showLog = !this.showLog;
                                  cx.notify();
                                },
                              ),
                            ),
                        ),
                      )
                      .when(Boolean(this.showLog && st.build_log), (el) =>
                        el.child(
                          div()
                            .id("latex-log")
                            .max_h(240)
                            .overflow_y_scrollbar()
                            .p(12)
                            .rounded(8)
                            .bg(t.background)
                            .font_family("Geist Mono")
                            .text_size(11)
                            .text_color(t.muted)
                            .child(st.build_log || ""),
                        ),
                      ),
                  ),
              ),
          ),
      )
      .child(
        v_flex()
          .flex_none()
          .px(22)
          .py(16)
          .gap(9)
          .border_t(1)
          .border_color(t.border)
          .bg(t.surface)
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(
                button(
                  "latex-build-preview",
                  this.stopPending
                    ? "Stopping…"
                    : running
                      ? "Stop"
                      : "Compile & Preview",
                  running ? "stop" : "play",
                  (cx) => this.act(running ? "stop" : "build-preview", cx),
                  true,
                  this.busy ||
                    this.stopPending ||
                    (!running && (!config.tex || !config.folder)),
                ).flex_1(),
              )
              .child(
                button(
                  "latex-preview",
                  "Preview",
                  "external",
                  (cx) => this.act("preview", cx),
                  false,
                  this.busy ||
                    this.stopPending ||
                    Boolean(st.building) ||
                    (!config.tex && !config.pdf) ||
                    !config.folder,
                ),
              )
              .child(
                iconButton(
                  "latex-compile",
                  "hammer",
                  "Compile only",
                  (cx) => this.act("compile", cx),
                  this.busy ||
                    this.stopPending ||
                    Boolean(st.building) ||
                    !config.tex ||
                    !config.folder,
                ),
              ),
          )
          .child(
            div()
              .text_size(10)
              .text_color(t.dim)
              .child(
                sessionHere && st.watching
                  ? "Updates every 3 seconds, including when this panel is closed."
                  : "Opens in your desktop PDF viewer.",
              ),
          ),
      );
  }
}
