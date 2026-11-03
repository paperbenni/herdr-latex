import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { controls } from "./controls.js";

/** @param {import("../main.js").default} panel */
export function documents(panel) {
  const { t, icon, iconButton, link, input, basename, directory } =
    controls(panel);
  const config = panel.config();
  const needle = panel.inputs.search.value().trim().toLowerCase();
  const allFiles = panel.files?.files || [];
  const mainCount = allFiles.filter((f) => f.main).length;
  const visible = allFiles.filter(
    (f) =>
      (!panel.mainsOnly || !mainCount || needle || f.main) &&
      f.path.toLowerCase().includes(needle),
  );
  const choosing = panel.choosing || !config.tex;

  return v_flex()
    .flex_none()
    .child(
      h_flex()
        .mt(24)
        .mb(9)
        .items_center()
        .justify_between()
        .child(div().text_size(13).font_semibold().child("Document"))
        .child(
          iconButton(
            "latex-find",
            "refresh",
            panel.files?.skipped
              ? "Navigate to a project folder to find documents"
              : panel.finding
                ? "Searching for documents…"
                : "Rescan current folder",
            (cx) => panel.discover(cx),
            panel.finding || Boolean(panel.files?.skipped),
          ),
        ),
    )
    .child(
      h_flex()
        .id("latex-document-picker")
        .p(13)
        .gap(11)
        .items_center()
        .rounded(10)
        .bg(t.background)
        .border(1)
        .border_color(choosing ? t.input : t.border)
        .cursor_pointer()
        .hover((s) => s.border_color(t.accent))
        .on_click((_e, cx) => {
          panel.choosing = !choosing;
          cx.notify();
        })
        .child(
          div()
            .text_color(config.tex ? t.accent : t.dim)
            .child(icon("document", 22)),
        )
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(3)
            .child(
              div()
                .text_size(15)
                .font_semibold()
                .truncate()
                .child(basename(config.tex)),
            )
            .when(Boolean(directory(config.tex)), (el) =>
              el.child(
                div()
                  .text_size(11)
                  .text_color(t.muted)
                  .truncate()
                  .child(directory(config.tex)),
              ),
            ),
        )
        .child(div().text_color(t.dim).child(icon("chevron", 15))),
    )
    .when(choosing, (el) =>
      el.child(
        v_flex()
          .mt(9)
          .gap(8)
          .when(panel.finding, (el) =>
            el.child(
              h_flex()
                .py(9)
                .gap(8)
                .text_color(t.muted)
                .child(icon("refresh", 14).spin(1400))
                .child("Finding documents…"),
            ),
          )
          .when(
            allFiles.length > 5 ||
              Boolean(needle) ||
              Boolean(panel.files?.truncated),
            (el) =>
              el.child(
                h_flex()
                  .gap(6)
                  .child(div().flex_1().min_w(0).child(input("search")))
                  .child(
                    iconButton(
                      "latex-search",
                      "search",
                      "Search filenames in the current folder",
                      (cx) => panel.discover(cx),
                      panel.finding,
                    ),
                  ),
              ),
          )
          .when(Boolean(panel.files), (el) =>
            el.child(
              v_flex()
                .id("latex-files")
                .max_h(210)
                .overflow_y_scrollbar()
                .gap(2)
                .when(visible.length === 0 && !panel.finding, (el) =>
                  el.child(
                    v_flex()
                      .p(10)
                      .gap(5)
                      .text_color(t.muted)
                      .child(
                        div().child(
                          panel.files?.skipped
                            ? "Open a project folder"
                            : needle
                              ? "No matching documents. Try another search."
                              : "No TeX files in this folder.",
                        ),
                      )
                      .when(Boolean(panel.files?.skipped), (el) =>
                        el.child(
                          div()
                            .text_size(11)
                            .text_color(t.dim)
                            .child(
                              "Navigate with Herdr or cd in the terminal. Home and system folders aren't searched.",
                            ),
                        ),
                      ),
                  ),
                )
                .children(
                  visible.map((file) =>
                    h_flex()
                      .id(`tex-${file.path}`)
                      .px(11)
                      .py(10)
                      .gap(10)
                      .rounded(7)
                      .cursor_pointer()
                      .bg(file.path === config.tex ? t.selected : t.surface)
                      .hover((s) => s.bg(t.hover))
                      .child(
                        div()
                          .text_color(
                            file.path === config.tex ? t.accent : t.dim,
                          )
                          .child(icon("document", 16)),
                      )
                      .child(
                        v_flex()
                          .flex_1()
                          .min_w(0)
                          .gap(2)
                          .child(
                            div()
                              .font_medium()
                              .truncate()
                              .child(basename(file.path)),
                          )
                          .when(Boolean(directory(file.path)), (el) =>
                            el.child(
                              div()
                                .text_size(10)
                                .text_color(t.dim)
                                .truncate()
                                .child(directory(file.path)),
                            ),
                          ),
                      )
                      .when(file.path === config.tex, (el) =>
                        el.child(
                          div().text_color(t.accent).child(icon("check", 15)),
                        ),
                      )
                      .on_click((_e, cx) => {
                        panel.inputs.tex.set_value(file.path);
                        panel.inputs.pdf.set_value("");
                        panel.choosing = false;
                        panel.save();
                        cx.notify();
                      }),
                  ),
                ),
            ),
          )
          .child(
            h_flex()
              .px(2)
              .justify_between()
              .items_center()
              .child(
                link(
                  "latex-manual-path",
                  panel.manualPath ? "Hide path input" : "Enter a file path",
                  (cx) => {
                    panel.manualPath = !panel.manualPath;
                    cx.notify();
                  },
                ),
              )
              .when(mainCount > 0 && allFiles.length > mainCount, (el) =>
                el.child(
                  link(
                    "latex-main-filter",
                    panel.mainsOnly
                      ? "Show included files"
                      : "Main documents only",
                    (cx) => {
                      panel.mainsOnly = !panel.mainsOnly;
                      cx.notify();
                    },
                  ),
                ),
              ),
          )
          .when(panel.manualPath, (el) => el.child(input("tex")))
          .when(Boolean(panel.files?.reason), (el) =>
            el.child(
              h_flex()
                .gap(7)
                .text_color(t.blocked)
                .text_size(11)
                .tooltip(panel.files?.reason || "")
                .child(icon("alert", 14))
                .child(
                  div()
                    .flex_1()
                    .child("Search incomplete. Narrow the filename filter."),
                ),
            ),
          )
          .when((panel.files?.errors.length || 0) > 0, (el) =>
            el.child(
              div()
                .text_size(11)
                .text_color(t.blocked)
                .tooltip((panel.files?.errors || []).join("; "))
                .child("Some folders could not be read."),
            ),
          ),
      ),
    );
}
