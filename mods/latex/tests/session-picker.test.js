import assert from "node:assert/strict";
import { test } from "node:test";
import Picker from "../session-picker.js";
import {
  mock,
  reset,
  config,
  space,
  pane,
} from "../../../tests/mocks/herdr.js";

function picker() {
  reset();
  const view = new Picker();
  view.init({
    sessionPicker: true,
    overlay: "picker",
    active: config(),
    current: { machine: "", folder: "/local/home" },
  });
  return view;
}

test("jump selects the matching pane on the correct machine using Herdr's pane field", () => {
  const view = picker();
  mock.panes = [
    pane({ pane: "wrong", tab: "local-tab" }),
    pane({ pane: "right", cwd: "/paper/" }),
  ];
  view.jump();
  assert.deepEqual(
    mock.calls.filter((call) => call.name !== "close"),
    [
      { name: "tab.select", args: { id: "remote-tab" } },
      { name: "pane.focus", args: { pane: "right" } },
      { name: "mod.open", args: { name: "latex" } },
    ],
  );
});

test("jump opens a tab if the old pane is gone", () => {
  const view = picker();
  mock.spaces = [space({ tabs: [] })];
  mock.panes = [];
  view.jump();
  assert.deepEqual(
    mock.calls.find((call) => call.name === "tab.new"),
    {
      name: "tab.new",
      args: { space: "remote-space", folder: "/paper", name: "LaTeX" },
    },
  );
});

test("jump creates a space when no space exists on the active machine", () => {
  const view = picker();
  mock.spaces = [];
  mock.panes = [];
  view.jump();
  assert.deepEqual(
    mock.calls.find((call) => call.name === "space.new"),
    {
      name: "space.new",
      args: { machine: "remote", folder: "/paper", name: "paper" },
    },
  );
});

test("open here does not navigate away or stop the active preview", () => {
  const view = picker();
  view.openHere();
  assert.deepEqual(
    mock.calls.filter((call) => call.name !== "close"),
    [{ name: "mod.open", args: { name: "latex" } }],
  );
});
