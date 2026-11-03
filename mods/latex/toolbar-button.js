import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { appHome, closeOverlay, exec, focused, home, layout, openOverlay, panes, readTextFile, run, shared, spaces, theme } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children || []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function isActive(status, now = Date.now() / 1000) {
  return Boolean(status?.pid && status.heartbeat && now - status.heartbeat < 180 && (status.building || status.watching));
}

function sameFolder(current, active) {
  const path = value => (value || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return Boolean(current && active && (current.machine || "") === (active.machine || "") && path(current.folder) === path(active.folder));
}

function currentFolder() {
  const f = focused();
  const space = spaces().find(s => s.id === f?.space);
  const machine = space?.machine || "";
  const tab = space?.tabs.find(t => t.id === f?.tab) || space?.tabs.find(t => t.active);
  const live = panes().find(p => p.tab === tab?.id && p.cwd);
  return { machine, folder: f?.cwd || live?.cwd || space?.folder || (machine ? "~" : home()) };
}

// Call from the parent toolbar render so Herdr subscribes it to context changes.
export function latexButtonContext() {
  return { current: currentFolder(), session: shared("latex.active-session"), compact: (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160 };
}

// Copy this module into a personal toolbar mod and mount with cx.new().
export default class LatexToolbarButton extends View {
  init(options, cx) {
    this.context = options?.current ? options : latexButtonContext();
    this.active = false;
    this.building = false;
    this.loading = false;
    this.refresh(cx);
    cx.timer.every(2000, cx => this.refresh(cx));
  }

  update(options) { this.context = options?.current ? options : latexButtonContext(); }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const file = shared("latex.status-file");
        let status = {};
        if (file) {
          const content = await readTextFile(file);
          status = content ? JSON.parse(content) : {};
        } else {
          const config = shared("latex.active-session");
          if (config) {
            const r = await exec("python3", [`${appHome()}/mods/latex/helper.py`, "status", "--config", JSON.stringify(config)]);
            if (r.code === 0) status = JSON.parse(r.stdout).status || {};
          }
        }
        const active = isActive(status);
        const building = Boolean(status.building);
        const changed = active !== this.active || building !== this.building || (active && status.heartbeat !== this.heartbeat);
        this.heartbeat = status.heartbeat;
        if (changed) { this.active = active; this.building = building; cx.notify(); }
      } catch {
        if (this.active) { this.active = false; cx.notify(); }
      } finally { this.loading = false; }
    });
  }

  open() {
    const current = currentFolder();
    const active = shared("latex.active-session");
    if (this.active && active && !sameFolder(current, active)) {
      closeOverlay("latex");
      openOverlay({ mod: "latex", props: { sessionPicker: true, current, active, building: this.building }, kind: "popup", width: 400, height: 212 });
    } else {
      run("mod.open", { name: "latex" });
    }
  }

  render() {
    const t = theme();
    const { compact, session, current } = this.context || latexButtonContext();
    const here = this.active && sameFolder(current, session);
    const elsewhere = this.active && session && !here;
    return h_flex().id("open-latex").h(26).w(compact ? 26 : 76).flex_none().gap(5).items_center().justify_center().rounded(6)
      .bg(here ? "#15803d" : t.raised).text_color(here ? "#ffffff" : t.accent).text_size(compact ? 11 : 12).font_medium().cursor_pointer()
      .hover(s => s.bg(here ? "#166534" : t.hover).text_color(here ? "#ffffff" : t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => this.open())
      .tooltip(elsewhere ? `${this.building ? "Build" : "Preview"} running in ${session.machine || "This computer"}: ${session.folder}\nOpen here or go to the active session` : here ? "LaTeX is active in this folder" : "Open LaTeX for the current folder")
      .when(here, el => el.child(div().text_size(11).child("▶")))
      .when(!compact || !here, el => el.child(compact ? "TeX" : "LaTeX"))
      .when(elsewhere && !compact, el => el.child(div().size(5).rounded_full().bg("#4ade80")));
  }
}
