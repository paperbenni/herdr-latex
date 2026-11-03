import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { controls } from "./controls.js";
import { closeOverlay, home, props } from "herdr";
import { isRecord } from "../model.js";
import { documents } from "./documents.js";
import { settings } from "./settings.js";
import { activity } from "./activity.js";
import { footer } from "./footer.js";

/** @param {import("../main.js").default} panel */
export function renderPanel(panel) {
  const { t, icon, iconButton } = controls(panel);
  const config = panel.config();
  const rawProps = props();
  const overlay =
    isRecord(rawProps) && typeof rawProps.overlay === "string"
      ? rawProps.overlay
      : null;
  const folderLabel =
    !config.machine && config.folder === home()
      ? "Home"
      : config.folder
          .replace(/\/$/, "")
          .split("/")
          .filter(Boolean)
          .slice(-2)
          .join("/") || config.folder;
  return v_flex()
    .id("latex-panel")
    .track_focus(panel.handle)
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
            .when(Boolean(panel.error), (el) =>
              el.child(
                h_flex()
                  .mt(15)
                  .p(11)
                  .gap(8)
                  .rounded(8)
                  .bg(t.background)
                  .text_color(t.blocked)
                  .child(icon("alert"))
                  .child(div().flex_1().child(panel.error)),
              ),
            )
            .child(documents(panel))
            .child(settings(panel))
            .child(activity(panel)),
        ),
    )
    .child(footer(panel));
}
