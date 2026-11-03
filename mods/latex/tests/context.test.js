import assert from "node:assert/strict";
import { test } from "node:test";
import Latex from "../main.js";
import { mock, reset, config } from "../../../tests/mocks/herdr.js";
import { context } from "../../../tests/mocks/context.js";
import { findElement, textContent } from "../../../tests/mocks/gpui-kit.js";

async function panel() {
  reset();
  mock.focus.cwd = "/remote/current";
  const harness = context();
  const view = new Latex();
  view.init({}, harness.cx);
  await harness.flush();
  return { view, ...harness };
}

test("uses the focused terminal folder instead of the space creation folder", async () => {
  const { view } = await panel();
  assert.equal(view.config().folder, "/remote/current");
  assert.equal(view.config().machine, "remote");
  assert.equal("folder" in view.inputs, false);
});

test("follows directory changes and restores document preferences per folder", async () => {
  const p = await panel();
  p.view.inputs.tex.set_value("slides/slides.tex");
  p.view.save();
  mock.focus.cwd = "/remote/other";
  p.view.followCurrent(p.cx);
  await p.flush();
  assert.equal(p.view.config().folder, "/remote/other");
  assert.equal(p.view.config().tex, "");
  mock.focus.cwd = "/remote/current";
  p.view.followCurrent(p.cx);
  await p.flush();
  assert.equal(p.view.config().tex, "slides/slides.tex");
});

test("uses a live pane without a focused cwd and follows machine changes", async () => {
  const p = await panel();
  mock.focus.cwd = null;
  p.view.followCurrent(p.cx);
  assert.equal(p.view.config().folder, "/paper");
  mock.focus = {
    ...mock.focus,
    space: "local-space",
    tab: "local-tab",
    cwd: "/local/project",
  };
  p.view.followCurrent(p.cx);
  assert.equal(p.view.config().machine, "");
  assert.equal(p.view.config().folder, "/local/project");
  await p.flush();
});

test("discards discovery that arrives after a folder change", async () => {
  const p = await panel();
  /** @type {Map<string, (value: unknown) => void>} */
  const replies = new Map();
  p.view.helper = async (_action, source) =>
    new Promise((resolve) => {
      replies.set(source.folder, resolve);
    });
  p.view.discover(p.cx);
  await p.flush();
  mock.focus.cwd = "/next-project";
  p.view.followCurrent(p.cx);
  await p.flush();
  replies.get("/remote/current")?.({
    ...mock.discovery,
    files: [{ path: "old.tex", main: true }],
  });
  await p.flush();
  assert.equal(p.view.files, null);
  replies.get("/next-project")?.({
    ...mock.discovery,
    folder: "/next-project",
    files: [{ path: "new.tex", main: true }],
  });
  await p.flush();
  assert.equal(p.view.config().tex, "new.tex");
});

test("the primary action stops this folder's build without a duplicate stop control", async () => {
  const p = await panel();
  p.view.inputs.tex.set_value("main.tex");
  p.view.active = p.view.config();
  p.view.status = { building: true };
  const tree = p.view.render(p.cx);
  const primary = findElement(tree, "latex-build-preview");
  assert.ok(primary);
  assert.equal(textContent(primary).trim(), "Stop");
  assert.equal(findElement(tree, "latex-stop"), undefined);
  primary.click?.({}, p.cx);
  await p.flush();
  assert.ok(
    mock.calls.some(
      (call) =>
        call.name === "exec" &&
        Array.isArray(call.args) &&
        call.args[1] === "stop",
    ),
  );
});

test("an unrelated preview does not turn the current folder's primary action into stop", async () => {
  const p = await panel();
  p.view.inputs.tex.set_value("main.tex");
  p.view.active = config({ folder: "/other-project" });
  p.view.status = { watching: true };
  const tree = p.view.render(p.cx);
  assert.equal(
    textContent(findElement(tree, "latex-build-preview")).trim(),
    "Compile & Preview",
  );
  assert.equal(textContent(tree).includes("Live preview"), false);
});

test("choosing a document clears the PDF override, saves it, and collapses the picker", async () => {
  const p = await panel();
  p.view.choosing = true;
  p.view.inputs.pdf.set_value("old.pdf");
  p.view.files = {
    ...mock.discovery,
    files: [{ path: "slides/slides.tex", main: true }],
  };
  const row = findElement(p.view.render(p.cx), "tex-slides/slides.tex");
  assert.ok(row?.click);
  row.click({}, p.cx);
  assert.equal(p.view.config().tex, "slides/slides.tex");
  assert.equal(p.view.config().pdf, "");
  assert.equal(p.view.choosing, false);
  assert.ok(
    JSON.stringify(mock.shared["latex.folder-projects"]).includes(
      "slides/slides.tex",
    ),
  );
});

test("build settings update the saved engine through the native controls", async () => {
  const p = await panel();
  p.view.advanced = true;
  const choice = findElement(p.view.render(p.cx), "engine-xelatex");
  assert.ok(choice?.click);
  choice.click({}, p.cx);
  assert.equal(p.view.config().engine, "xelatex");
  assert.ok(
    JSON.stringify(mock.shared["latex.folder-projects"]).includes("xelatex"),
  );
});
