import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { closeOverlay, layout, openOverlay, run, shared } from "herdr";
import { activeSession, palette, isRecord } from "./model.js";
import { currentSource, isActive, sameFolder } from "./session.js";
import { queryStatus, readStatusFile } from "./helper-client.js";
export { isActive, sameFolder } from "./session.js";

/** @param {unknown} node @param {string} id @returns {{size: {px: number}} | null} */
function find(node, id) {
  if (!isRecord(node)) return null;
  if (node.id === id)
    return {
      size: {
        px:
          isRecord(node.size) && typeof node.size.px === "number"
            ? node.size.px
            : Infinity,
      },
    };
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = find(child, id);
      if (found) return found;
    }
  }
  return null;
}

// Call from the parent toolbar render so Herdr subscribes it to context changes.
/** @returns {import("./contracts.js").ToolbarContext} */
export function latexButtonContext() {
  return {
    current: currentSource(),
    session: activeSession(),
    compact: (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160,
  };
}

// Copy this module into a personal toolbar mod and mount with cx.new().
export default class LatexToolbarButton extends View {
  /** @type {import("./contracts.js").ToolbarContext} */ context;
  /** @type {number | undefined} */ heartbeat;
  active = false;
  building = false;
  loading = false;
  /** @param {import("gpui-shell").Props | undefined} _options @param {import("gpui-kit").AsyncContext} cx */
  init(_options, cx) {
    this.context = latexButtonContext();
    this.active = false;
    this.building = false;
    this.loading = false;
    this.refresh(cx);
    cx.timer.every(2000, (cx) => this.refresh(cx));
  }

  /** @param {import("gpui-shell").Props | undefined} _options */
  update(_options) {
    this.context = latexButtonContext();
  }

  /** @param {import("gpui-kit").Context} cx */
  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const file = shared("latex.status-file");
        /** @type {import("./contracts.js").Status} */
        let status = {};
        if (typeof file === "string") {
          status = await readStatusFile(file);
        } else {
          const config = activeSession();
          if (config) status = (await queryStatus(config)).status;
        }
        const active = isActive(status);
        const building = Boolean(status.building);
        const changed =
          active !== this.active ||
          building !== this.building ||
          (active && status.heartbeat !== this.heartbeat);
        this.heartbeat = status.heartbeat;
        if (changed) {
          this.active = active;
          this.building = building;
          cx.notify();
        }
      } catch {
        if (this.active) {
          this.active = false;
          cx.notify();
        }
      } finally {
        this.loading = false;
      }
    });
  }

  open() {
    const current = currentSource();
    const active = activeSession();
    if (this.active && active && !sameFolder(current, active)) {
      closeOverlay("latex");
      openOverlay({
        mod: "latex",
        props: {
          sessionPicker: true,
          current,
          active,
          building: this.building,
        },
        kind: "popup",
        width: 400,
        height: 212,
      });
    } else {
      run("mod.open", { name: "latex" });
    }
  }

  render() {
    const t = palette();
    const { compact, session, current } = this.context || latexButtonContext();
    const here = this.active && sameFolder(current, session);
    const elsewhere = this.active && session && !here;
    return h_flex()
      .id("open-latex")
      .h(26)
      .w(compact ? 26 : 76)
      .flex_none()
      .gap(5)
      .items_center()
      .justify_center()
      .rounded(6)
      .bg(here ? "#15803d" : t.raised)
      .text_color(here ? "#ffffff" : t.accent)
      .text_size(compact ? 11 : 12)
      .font_medium()
      .cursor_pointer()
      .hover((s) =>
        s
          .bg(here ? "#166534" : t.hover)
          .text_color(here ? "#ffffff" : t.foreground),
      )
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => this.open())
      .tooltip(
        elsewhere
          ? `${this.building ? "Build" : "Preview"} running in ${session.machine || "This computer"}: ${session.folder}\nOpen here or go to the active session`
          : here
            ? "LaTeX is active in this folder"
            : "Open LaTeX for the current folder",
      )
      .when(here, (el) => el.child(div().text_size(11).child("▶")))
      .when(!compact || !here, (el) => el.child(compact ? "TeX" : "LaTeX"))
      .when(elsewhere && !compact, (el) =>
        el.child(div().size(5).rounded_full().bg("#4ade80")),
      );
  }
}
