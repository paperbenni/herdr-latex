import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, exec, focused, home, nextCommand, panes, readTextFile, shared, setShared, spaces, theme } from "herdr";

const ENGINES = [["pdflatex", "PDFLaTeX"], ["lualatex", "LuaLaTeX"], ["xelatex", "XeLaTeX"]];
const sourceKey = c => JSON.stringify([c.machine || "", c.folder]);
const configKey = c => JSON.stringify([c.machine || "", c.folder, c.tex, c.pdf, c.engine]);

function context() {
  const f = focused();
  const space = spaces().find(s => s.id === f?.space);
  const machine = space?.machine || "";
  const tab = space?.tabs.find(t => t.id === f?.tab) || space?.tabs.find(t => t.active);
  const live = panes().find(p => p.tab === tab?.id && p.cwd);
  return { machine, folder: f?.cwd || live?.cwd || space?.folder || (machine ? "~" : home()) };
}

export default class Latex extends View {
  init(_props, cx) {
    const here = context();
    this.source = here;
    const previous = shared("latex.active-session");
    const saved = (shared("latex.folder-projects") || {})[sourceKey(here)] || (previous && sourceKey(previous) === sourceKey(here) ? previous : {});
    const initial = { tex: "", pdf: "", engine: "pdflatex", ...saved, ...here };
    this.engine = initial.engine;
    this.inputs = {};
    this.generation = 0;
    for (const [key, placeholder] of [["tex", "Choose a document below, or enter its path"], ["pdf", "Automatic: PDF next to the main TeX file"], ["search", "Filter by filename or path, e.g. slides"]]) {
      const input = InputState.new({ value: initial[key] || "", placeholder });
      input.on("change", (_e, cx) => {
        if (key !== "search") this.save();
        this.error = "";
        cx.notify();
      });
      this.inputs[key] = input;
    }
    this.inputs.search.on("submit", (_e, cx) => this.discover(cx));
    this.active = shared("latex.active-session") || this.config();
    this.status = {};
    this.files = null;
    this.error = "";
    this.busy = false;
    this.finding = false;
    this.polling = false;
    this.mainsOnly = true;
    this.advanced = Boolean(initial.pdf);
    this.showLog = false;
    this.handle = cx.focus_handle();
    this.poll(cx);
    this.discover(cx);
    cx.timer.every(2000, cx => this.poll(cx));
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.inputs.tex.focus();
        if (["compile", "preview", "build-preview", "stop", "refresh"].includes(command)) this.act(command, cx);
        if (command === "find") this.discover(cx);
        cx.notify();
      }
    });
  }

  config() {
    return { ...this.source, tex: this.inputs.tex.value().trim(), pdf: this.inputs.pdf.value().trim(), engine: this.engine };
  }

  save() {
    const config = this.config();
    setShared("latex.folder-projects", { ...(shared("latex.folder-projects") || {}), [sourceKey(this.source)]: config });
  }

  invalidateFiles() { this.files = null; this.generation++; this.finding = false; }

  followCurrent(cx) {
    const here = context();
    if (sourceKey(here) === sourceKey(this.source)) return;
    this.source = here;
    const previous = shared("latex.active-session");
    const saved = (shared("latex.folder-projects") || {})[sourceKey(here)] || (previous && sourceKey(previous) === sourceKey(here) ? previous : {});
    this.engine = saved.engine || "pdflatex";
    for (const key of ["tex", "pdf"]) this.inputs[key].set_value(saved[key] || "");
    this.inputs.search.set_value("");
    this.advanced = Boolean(saved.pdf);
    this.invalidateFiles();
    this.error = "";
    cx.notify();
    this.discover(cx);
  }

  async helper(action, config, search = "") {
    const r = await exec("python3", [`${appHome()}/mods/latex/helper.py`, action, "--config", JSON.stringify(config), "--search", search]);
    let data;
    try { data = JSON.parse(r.stdout); } catch { throw new Error(r.stderr || r.stdout || "The LaTeX helper did not reply."); }
    if (r.code !== 0 || data.error) throw new Error(data.error || r.stderr || "LaTeX helper failed.");
    return data;
  }

  poll(cx) {
    if (this.polling) return;
    this.polling = true;
    const active = this.active;
    const statusFile = this.statusFile;
    cx.spawn(async cx => {
      try {
        let status;
        if (!statusFile) {
          const r = await this.helper("status", active);
          if (active !== this.active) return;
          this.statusFile = r.status_file;
          if (shared("latex.status-file") !== r.status_file) setShared("latex.status-file", r.status_file);
          status = r.status;
        } else {
          const content = await readTextFile(statusFile);
          if (active !== this.active) return;
          status = content ? JSON.parse(content) : {};
        }
        if (status.pid && Date.now() / 1000 - status.heartbeat > 180) status = { ...status, watching: false, building: false, phase: "Helper stopped responding. Try again." };
        this.status = status;
        if (status.build_code !== undefined && status.build_code !== null && status.build_code !== 0) this.showLog = true;
      } catch (e) { this.error = String(e); }
      finally { this.polling = false; cx.notify(); }
    });
  }

  act(action, cx) {
    if (this.busy) return;
    this.followCurrent(cx);
    const config = ["stop", "refresh"].includes(action) ? this.active : this.config();
    if (!config.folder || (["compile", "build-preview"].includes(action) && !config.tex) || (action === "preview" && !config.tex && !config.pdf)) {
      this.error = "Choose a main document first, or enter a PDF path under PDF output.";
      cx.notify(); return;
    }
    const changed = configKey(config) !== configKey(this.active);
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        if (changed && this.status.watching) await this.helper("stop", this.active);
        const r = await this.helper(action, config);
        this.active = config;
        setShared("latex.active-session", config);
        this.statusFile = r.status_file;
        setShared("latex.status-file", r.status_file);
        const build = ["compile", "build-preview"].includes(action);
        this.status = { ...(changed ? {} : this.status), building: build || (!changed && this.status.building), phase: build ? "Starting build…" : action === "stop" ? "Stopping preview updates…" : "Fetching PDF…" };
        this.save();
      } catch (e) { this.error = String(e); }
      this.busy = false;
      cx.notify();
      this.poll(cx);
    });
  }

  discover(cx) {
    if (this.finding) return;
    if (!this.config().folder) { this.error = "Enter a project folder first."; cx.notify(); return; }
    this.finding = true;
    this.error = "";
    const generation = ++this.generation;
    const config = this.config();
    const search = this.inputs.search.value().trim();
    cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await this.helper("discover", config, search);
        if (generation !== this.generation || sourceKey(config) !== sourceKey(this.config())) return;
        this.files = result;
        const mains = result.files.filter(f => f.main);
        if (!this.inputs.tex.value() && mains.length === 1) { this.inputs.tex.set_value(mains[0].path); this.save(); }
      } catch (e) { if (generation === this.generation) this.error = String(e); }
      finally { if (generation === this.generation) this.finding = false; cx.notify(); }
    });
  }

  render(cx) {
    // Herdr re-renders on live context changes. Defer input updates out of render.
    if (sourceKey(context()) !== sourceKey(this.source) && !this.contextPending) {
      this.contextPending = true;
      cx.spawn(async cx => {
        await cx.sleep(0);
        this.contextPending = false;
        this.followCurrent(cx);
      });
    }
    const t = theme();
    const st = this.status;
    const config = this.config();
    const same = configKey(config) === configKey(this.active);
    const building = same && st.building;
    const button = (id, text, action, primary = false, disabled = false) => h_flex().id(id).h(32).px(10).items_center().justify_center().rounded(7)
      .bg(primary ? t.solid : t.raised).border(1).border_color(primary ? t.solid : t.input)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12).font_medium()
      .when(disabled, el => el.opacity(0.45))
      .when(!disabled, el => el.cursor_pointer().hover(s => s.opacity(0.85)).on_click((_e, cx) => action(cx))).child(text);
    const link = (id, text, action) => div().id(id).text_size(11).text_color(t.accent).cursor_pointer().on_click((_e, cx) => action(cx)).child(text);
    const label = text => div().mt(12).mb(5).text_size(11).font_medium().text_color(t.muted).child(text);
    const input = key => Input.new(this.inputs[key]).flex_none().h(34).px(10).rounded(7).border(1).border_color(t.input).bg(t.background).text_color(t.foreground).text_size(12);
    const needle = this.inputs.search.value().trim().toLowerCase();
    const allFiles = this.files?.files || [];
    const mainCount = allFiles.filter(f => f.main).length;
    const visible = allFiles.filter(f => (!this.mainsOnly || !mainCount || needle || f.main) && f.path.toLowerCase().includes(needle));
    return v_flex().id("latex-panel").track_focus(this.handle).size_full().bg(t.surface).text_color(t.foreground).text_size(12)
      .child(h_flex().flex_none().px(18).py(12).items_center().justify_between().border_b(1).border_color(t.border)
        .child(div().text_size(20).font_semibold().child("LaTeX"))
        .child(div().text_size(11).text_color(t.muted).child("Build remotely · view locally")))
      .child(v_flex().id("latex-content").flex_1().min_h(0).overflow_y_scrollbar().child(v_flex().flex_none().px(18).pb(14)
        .when(Boolean(this.error), el => el.child(div().mt(10).p(10).rounded(7).bg(t.background).text_color(t.blocked).child(this.error)))
        .child(v_flex().mt(12).p(10).gap(4).rounded(7).bg(t.background)
          .child(div().text_size(11).font_medium().text_color(t.accent).child(config.machine || "This computer"))
          .child(div().text_size(12).child(config.folder))
          .child(div().text_size(10).text_color(t.dim).child("Follows the current Herdr session and working directory.")))
        .child(h_flex().mt(12).mb(5).items_center().justify_between()
          .child(div().text_size(11).text_color(t.muted).child("MAIN DOCUMENT"))
          .child(link("latex-find", this.finding ? "Searching…" : this.files ? "Rescan folder" : "Find .tex files", cx => this.discover(cx))))
        .child(input("tex"))
        .child(div().mt(6).text_size(10).text_color(t.dim).child("Paths below are relative to the project folder. Main documents contain \\documentclass."))
        .when(this.finding, el => el.child(div().mt(8).text_color(t.muted).child("Searching for TeX documents…")))
        .when(this.files !== null, el => el.child(v_flex().mt(8).gap(6)
          .child(h_flex().gap(6).child(div().flex_1().child(input("search")))
            .child(button("latex-search", "Search", cx => this.discover(cx), false, this.finding)))
          .child(h_flex().justify_between().items_center()
            .child(div().text_size(10).text_color(t.muted).child(`${visible.length} shown · ${allFiles.length} TeX files${this.files.truncated ? " · partial results" : ""}`))
            .when(mainCount > 0, el => el.child(link("latex-main-filter", this.mainsOnly ? "Show all TeX files" : "Main documents only", cx => { this.mainsOnly = !this.mainsOnly; cx.notify(); }))))
          .child(v_flex().id("latex-files").max_h(150).overflow_y_scrollbar().gap(2)
            .when(visible.length === 0, el => el.child(div().p(8).text_color(t.muted).child(needle ? "No matching files in these results. Press Search to search the folder." : "No TeX documents found in this folder.")))
            .children(visible.map(file => h_flex().id(`tex-${file.path}`).px(9).py(7).gap(8).rounded(5).cursor_pointer().bg(file.path === config.tex ? t.selected : t.background).hover(s => s.bg(t.hover))
              .child(div().flex_1().text_color(t.accent).child(file.path))
              .when(file.main, el => el.child(div().text_size(10).text_color(t.dim).child("main")))
              .on_click((_e, cx) => { this.inputs.tex.set_value(file.path); this.inputs.pdf.set_value(""); this.save(); cx.notify(); }))))
          .child(div().text_size(10).text_color(t.dim).child(`Searched ${this.files.folder}`))
          .when(Boolean(this.files.reason), el => el.child(div().text_size(11).text_color(t.blocked).child(this.files.reason || "")))
          .when(this.files.errors?.length > 0, el => el.child(div().text_size(11).text_color(t.blocked).child(`Some folders could not be read: ${this.files.errors.join("; ")}`)))))
        .child(label("ENGINE"))
        .child(h_flex().gap(6).flex_wrap().children(ENGINES.map(([key, title]) => button(`engine-${key}`, title, cx => { this.engine = key; this.save(); cx.notify(); }, this.engine === key))))
        .child(div().mt(12).child(link("latex-advanced", this.advanced ? "Hide PDF output settings" : "PDF output settings…", cx => { this.advanced = !this.advanced; cx.notify(); })))
        .when(this.advanced, el => el.child(v_flex().mt(7).gap(5).child(input("pdf"))
          .child(div().text_size(10).text_color(t.dim).child("Override the PDF to download, e.g. build/slides.pdf. This does not change the compiler's output directory."))))
        .child(v_flex().mt(14).p(11).gap(6).rounded(8).bg(t.background).border(1).border_color(t.border)
          .child(div().font_medium().text_color(st.build_code === 0 ? t.done : t.foreground).child(st.phase || "Choose a document, then compile or preview."))
          .when(Boolean(st.building || st.watching || st.updated || st.build_log), el => el.child(div().text_size(10).text_color(t.muted).child(`${this.active.machine || "This computer"} · ${this.active.tex || this.active.pdf}`)))
          .when(!same && Boolean(st.building || st.watching), el => el.child(div().text_size(10).text_color(t.muted).child("This session belongs to the previous selection. Its controls remain below.")))
          .when(Boolean(st.updated), el => el.child(div().text_size(10).text_color(t.muted).child(`Local PDF updated ${st.updated ? new Date(st.updated * 1000).toLocaleTimeString() : ""}`)))
          .when(Boolean(st.error), el => el.child(div().text_color(t.blocked).child(st.error)))
          .when(Boolean(st.watching), el => el.child(h_flex().gap(6)
            .child(button("latex-refresh", "Refresh now", cx => this.act("refresh", cx), false, this.busy))
            .child(button("latex-stop", "Stop updates", cx => this.act("stop", cx), false, this.busy))))
          .when(Boolean(st.build_log), el => el.child(link("latex-toggle-log", this.showLog ? "Hide build log" : "Show build log", cx => { this.showLog = !this.showLog; cx.notify(); }))))
        .when(Boolean(this.showLog && st.build_log), el => el.child(div().id("latex-log").mt(8).max_h(280).overflow_y_scrollbar().p(10).rounded(7).bg(t.background).font_family("Geist Mono").text_size(11).text_color(t.muted).child(st.build_log || "")))))
      .child(v_flex().flex_none().px(18).py(12).gap(7).border_t(1).border_color(t.border).bg(t.surface)
        .child(h_flex().gap(6).flex_wrap()
          .child(button("latex-build-preview", building ? "Compiling…" : "Compile & Preview", cx => this.act("build-preview", cx), true, this.busy || building || !config.tex || !config.folder))
          .child(button("latex-compile", "Compile", cx => this.act("compile", cx), false, this.busy || building || !config.tex || !config.folder))
          .child(button("latex-preview", "Preview ↗", cx => this.act("preview", cx), false, this.busy || (!config.tex && !config.pdf) || !config.folder)))
        .child(div().text_size(10).text_color(t.dim).child("Preview uses your desktop PDF viewer. Updates run every 3 seconds, even with this panel closed (up to 12 hours).")));
  }
}
