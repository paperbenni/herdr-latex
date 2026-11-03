import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { controls } from "./controls.js";
import { sameFolder } from "../session.js";

/** @param {import("../main.js").default} panel */
export function footer(panel) {
  const { t, button, iconButton } = controls(panel);
  const config = panel.config();
  const st = panel.status;
  const sessionHere = sameFolder(config, panel.active);
  const running =
    sessionHere && Boolean(st.building || st.watching || panel.stopPending);
  return v_flex()
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
            panel.stopPending
              ? "Stopping…"
              : running
                ? "Stop"
                : "Compile & Preview",
            running ? "stop" : "play",
            (cx) => panel.act(running ? "stop" : "build-preview", cx),
            true,
            panel.busy ||
              panel.stopPending ||
              (!running && (!config.tex || !config.folder)),
          ).flex_1(),
        )
        .child(
          button(
            "latex-preview",
            "Preview",
            "external",
            (cx) => panel.act("preview", cx),
            false,
            panel.busy ||
              panel.stopPending ||
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
            (cx) => panel.act("compile", cx),
            panel.busy ||
              panel.stopPending ||
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
    );
}
