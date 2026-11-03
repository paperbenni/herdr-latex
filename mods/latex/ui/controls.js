import { div, svg } from "gpui-kit";
import { h_flex, Input } from "gpui-base";
import { palette } from "../model.js";

/** Shared native controls; event handlers receive their own live context.
 * @param {import("../main.js").default} panel
 */
export function controls(panel) {
  const t = palette();
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
  /** @param {import("../contracts.js").InputKey} key */
  const input = (key) =>
    Input.new(panel.inputs[key])
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

  return { t, icon, button, iconButton, link, input, basename, directory };
}
