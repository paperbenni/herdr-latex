import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { controls } from "./controls.js";

/** @type {ReadonlyArray<readonly [import("../contracts.js").Engine, string]>} */
const ENGINES = [
  ["pdflatex", "PDFLaTeX"],
  ["lualatex", "LuaLaTeX"],
  ["xelatex", "XeLaTeX"],
];

/** @param {import("../main.js").default} panel */
export function settings(panel) {
  const { t, icon, button, input } = controls(panel);

  return v_flex()
    .flex_none()
    .child(
      h_flex()
        .id("latex-advanced")
        .mt(20)
        .py(12)
        .gap(8)
        .items_center()
        .border_t(1)
        .border_color(t.border)
        .cursor_pointer()
        .text_color(t.muted)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          panel.advanced = !panel.advanced;
          cx.notify();
        })
        .child(icon("settings", 15))
        .child(div().flex_1().child("Build settings"))
        .child(
          div()
            .text_size(11)
            .text_color(t.dim)
            .child(
              ENGINES.find(([key]) => key === panel.engine)?.[1] ||
                panel.engine,
            ),
        )
        .child(icon("chevron", 14)),
    )
    .when(panel.advanced, (el) =>
      el.child(
        v_flex()
          .pb(8)
          .gap(12)
          .child(
            h_flex()
              .gap(5)
              .flex_wrap()
              .children(
                ENGINES.map(([key, title]) =>
                  button(`engine-${key}`, title, "", (cx) => {
                    panel.engine = key;
                    panel.save();
                    cx.notify();
                  }).when(panel.engine === key, (el) =>
                    el
                      .bg(t.selected)
                      .border_color(t.accent)
                      .text_color(t.accent),
                  ),
                ),
              ),
          )
          .child(
            v_flex()
              .gap(5)
              .child(
                div().text_size(11).text_color(t.muted).child("PDF to open"),
              )
              .child(
                input("pdf").tooltip(
                  "Optional PDF override, relative to the current folder. Compiler output settings remain controlled by your project.",
                ),
              )
              .child(
                div()
                  .text_size(10)
                  .text_color(t.dim)
                  .child("Leave blank to use the PDF next to your TeX file."),
              ),
          ),
      ),
    );
}
