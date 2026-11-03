import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { controls } from "./controls.js";
import { configKey, sameFolder } from "../session.js";

/** @param {import("../main.js").default} panel */
export function activity(panel) {
  const { t, icon, iconButton, link } = controls(panel);
  const st = panel.status;
  const config = panel.config();
  const same = configKey(config) === configKey(panel.active);
  const sessionHere = sameFolder(config, panel.active);
  const failed =
    st.build_code !== undefined &&
    st.build_code !== null &&
    st.build_code !== 0;
  const statusTitle = panel.stopPending
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
    .flex_none()
    .when(
      Boolean(sessionHere && (statusTitle || st.error || st.build_log)),
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
                      (cx) => panel.act("refresh", cx),
                      panel.busy || panel.stopPending,
                    ),
                  ),
                ),
            )
            .when(!same && Boolean(st.building || st.watching), (el) =>
              el.child(
                div()
                  .text_size(11)
                  .text_color(t.muted)
                  .child(
                    `${panel.active.machine || "This computer"} · ${panel.active.tex || panel.active.pdf}`,
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
                      panel.showLog ? "Hide build log" : "View build log",
                      (cx) => {
                        panel.showLog = !panel.showLog;
                        cx.notify();
                      },
                    ),
                  ),
              ),
            )
            .when(Boolean(panel.showLog && st.build_log), (el) =>
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
    );
}
