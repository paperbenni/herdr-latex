import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, panes, run, spaces, theme } from "herdr";

const normalized = path => (path || "").replace(/\\/g, "/").replace(/\/+$/, "");

function jumpTarget(active, allSpaces, allPanes) {
  const candidates = allSpaces.filter(s => (s.machine || "") === (active.machine || ""));
  const tabs = new Set(candidates.flatMap(s => s.tabs.map(t => t.id)));
  const pane = allPanes.find(p => tabs.has(p.tab) && p.cwd && normalized(p.cwd) === normalized(active.folder));
  return { pane, space: candidates[0] };
}

export default class LatexSessionPicker extends View {
  init(options) { this.options = options; }

  openHere() {
    closeOverlay(this.options.overlay);
    closeOverlay("latex");
    run("mod.open", { name: "latex" });
  }

  jump() {
    const active = this.options.active;
    const target = jumpTarget(active, spaces(), panes());
    closeOverlay(this.options.overlay);
    closeOverlay("latex");
    if (target.pane) {
      run("tab.select", { id: target.pane.tab });
      run("pane.focus", { pane: target.pane.id });
    } else if (target.space) {
      run("tab.new", { space: target.space.id, folder: active.folder, name: "LaTeX" });
    } else {
      run("space.new", { machine: active.machine || "", folder: active.folder, name: active.folder.split("/").filter(Boolean).pop() || "LaTeX" });
    }
    run("mod.open", { name: "latex" });
  }

  render() {
    const t = theme();
    const { current, active, building } = this.options;
    const icon = name => svg(`mods/latex/icons/${name}.svg`).size(18).flex_none();
    const option = (id, title, config, symbol, action, accent) => h_flex().id(id).p(12).gap(11).items_center().rounded(8).cursor_pointer()
      .bg(t.background).hover(s => s.bg(t.hover)).on_click(action)
      .child(div().text_color(accent ? "#4ade80" : t.accent).child(icon(symbol)))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().font_medium().text_color(t.foreground).child(title))
        .child(div().text_size(10).text_color(t.muted).truncate().child(`${config.machine || "This computer"} · ${config.folder.split("/").filter(Boolean).slice(-2).join("/") || "/"}`)))
      .tooltip(`${config.machine || "This computer"}: ${config.folder}`);
    return v_flex().w_full().p(14).gap(8).bg(t.popover).text_size(12)
      .child(div().px(2).pb(4).font_semibold().text_color(t.foreground).child(building ? "A build is running elsewhere" : "A preview is running elsewhere"))
      .child(option("latex-open-here", "Open LaTeX here", current, "folder", () => this.openHere(), false))
      .child(option("latex-go-active", building ? "Go to active build" : "Go to active preview", active, "external", () => this.jump(), true));
  }
}
