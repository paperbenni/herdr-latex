import assert from "node:assert/strict";
import { test } from "node:test";
import Button, {
  isActive,
  sameFolder,
  latexButtonContext,
} from "../toolbar-button.js";
import { mock, reset, config } from "../../../tests/mocks/herdr.js";
import { context } from "../../../tests/mocks/context.js";
import { findElement, textContent } from "../../../tests/mocks/gpui-kit.js";

async function button() {
  reset();
  const harness = context();
  const view = new Button();
  view.init(undefined, harness.cx);
  await harness.flush();
  return { view, ...harness };
}

test("activity requires a live build or watcher and a fresh heartbeat", () => {
  assert.equal(isActive({ pid: 1, heartbeat: 100, watching: true }, 110), true);
  assert.equal(isActive({ pid: 1, heartbeat: 100, building: true }, 110), true);
  assert.equal(
    isActive({ pid: 1, heartbeat: 100, watching: false, building: false }, 110),
    false,
  );
  assert.equal(
    isActive({ pid: 1, heartbeat: 100, watching: true }, 300),
    false,
  );
  assert.equal(isActive({ heartbeat: 100, watching: true }, 110), false);
});

test("the toolbar reads worker status without the panel being open", async () => {
  const p = await button();
  mock.shared["latex.status-file"] = "/state/status.json";
  mock.status = { pid: 1, heartbeat: Date.now() / 1000, watching: true };
  p.view.refresh(p.cx);
  await p.flush();
  assert.equal(p.view.active, true);
  mock.status.watching = false;
  p.view.refresh(p.cx);
  await p.flush();
  assert.equal(p.view.active, false);
});

test("existing sessions are found before the status-file pointer is saved", async () => {
  const p = await button();
  mock.shared["latex.active-session"] = config();
  mock.status = { pid: 1, heartbeat: Date.now() / 1000, building: true };
  p.view.refresh(p.cx);
  await p.flush();
  assert.equal(p.view.active, true);
});

test("the machine and folder both participate in activity ownership", () => {
  assert.equal(sameFolder(config({ folder: "/paper/" }), config()), true);
  assert.equal(sameFolder(config({ machine: "other" }), config()), false);
  assert.equal(sameFolder(config({ folder: "/elsewhere" }), config()), false);
});

test("activity elsewhere opens a chooser with both source locations", async () => {
  const p = await button();
  const active = config({ folder: "/other-project" });
  mock.shared["latex.active-session"] = active;
  p.view.active = true;
  p.view.open();
  const popup = mock.calls.find((call) => call.name === "popup")?.args;
  assert.deepEqual(popup, {
    mod: "latex",
    props: {
      sessionPicker: true,
      current: { machine: "remote", folder: "/paper" },
      active,
      building: false,
    },
    kind: "popup",
    width: 400,
    height: 212,
  });
  assert.equal(
    mock.calls.some((call) => call.name === "mod.open"),
    false,
  );
});

test("same-folder and inactive clicks open the current panel directly", async () => {
  const p = await button();
  mock.shared["latex.active-session"] = config();
  p.view.active = true;
  p.view.open();
  assert.deepEqual(
    mock.calls.filter((call) => call.name === "mod.open"),
    [{ name: "mod.open", args: { name: "latex" } }],
  );
  mock.calls = [];
  p.view.active = false;
  mock.focus.cwd = "/another-folder";
  p.view.open();
  assert.deepEqual(mock.calls, [{ name: "mod.open", args: { name: "latex" } }]);
});

test("forwarded context updates change the play symbol when switching folders", async () => {
  const p = await button();
  mock.shared["latex.active-session"] = config();
  p.view.active = true;
  p.view.update(latexButtonContext());
  assert.ok(textContent(p.view.render()).includes("▶"));
  mock.focus.cwd = "/another-folder";
  p.view.update(latexButtonContext());
  assert.equal(textContent(p.view.render()).includes("▶"), false);
  assert.ok(findElement(p.view.render(), "open-latex"));
});
