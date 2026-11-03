import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { appHome, exec, layout, readTextFile, run, shared, theme } from "herdr";

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

// Copy this module into a personal toolbar mod and mount with cx.new().
export default class LatexToolbarButton extends View {
  init(_props, cx) {
    this.active = false;
    this.loading = false;
    this.refresh(cx);
    cx.timer.every(2000, cx => this.refresh(cx));
  }

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
        if (active !== this.active) { this.active = active; cx.notify(); }
      } catch {
        if (this.active) { this.active = false; cx.notify(); }
      } finally { this.loading = false; }
    });
  }

  render() {
    const t = theme();
    const compact = (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
    return h_flex().id("open-latex").h(26).w(compact ? 26 : 76).flex_none().gap(5).items_center().justify_center().rounded(6)
      .bg(this.active ? "#15803d" : t.raised).text_color(this.active ? "#ffffff" : t.accent).text_size(compact ? 11 : 12).font_medium().cursor_pointer()
      .hover(s => s.bg(this.active ? "#166534" : t.hover).text_color(this.active ? "#ffffff" : t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => run("mod.open", { name: "latex" }))
      .when(this.active, el => el.child(div().text_size(11).child("▶")))
      .when(!compact || !this.active, el => el.child(compact ? "TeX" : "LaTeX"));
  }
}
