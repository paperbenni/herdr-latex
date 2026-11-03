import { View } from "gpui-kit";
import { InputState } from "gpui-base";
import { nextCommand, props, shared, setShared } from "herdr";
import LatexSessionPicker from "./session-picker.js";
import {
  activeSession,
  savedProjects,
  readActionReply,
  readDiscovery,
  readPickerOptions,
} from "./model.js";

import {
  currentSource,
  sourceKey,
  configKey,
  projectConfig,
} from "./session.js";
import { callHelper, readStatusFile, queryStatus } from "./helper-client.js";
import { renderPanel } from "./ui/panel.js";

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
    const here = currentSource();
    this.source = here;
    const initial = projectConfig(here);
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
    for (const key of /** @type {const} */ (["tex", "pdf", "search"])) {
      this.inputs[key].on("change", (_e, cx) => {
        if (key !== "search") this.save();
        this.error = "";
        cx.notify();
      });
    }
    this.inputs.search.on("submit", (_e, cx) => this.discover(cx));
    this.active = activeSession() || this.config();
    this.advanced = Boolean(initial.pdf);
    this.choosing = !initial.tex;
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
    const here = currentSource();
    if (sourceKey(here) === sourceKey(this.source)) return;
    this.source = here;
    const saved = projectConfig(here);
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
    return callHelper(action, config, search);
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
          const r = await queryStatus(active);
          if (active !== this.active) return;
          this.statusFile = r.status_file;
          if (shared("latex.status-file") !== r.status_file)
            setShared("latex.status-file", r.status_file);
          status = r.status;
        } else {
          const statusFromFile = await readStatusFile(statusFile);
          if (active !== this.active) return;
          status = statusFromFile;
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
      sourceKey(currentSource()) !== sourceKey(this.source) &&
      !this.contextPending
    ) {
      this.contextPending = true;
      cx.spawn(async (cx) => {
        await cx.sleep(0);
        this.contextPending = false;
        this.followCurrent(cx);
      });
    }
    return renderPanel(this);
  }
}
