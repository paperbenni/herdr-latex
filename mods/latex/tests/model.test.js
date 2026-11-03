import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readConfig,
  readStatus,
  readDiscovery,
  readPickerOptions,
  savedProjects,
  palette,
} from "../model.js";
import { mock, reset, config } from "../../../tests/mocks/herdr.js";

test("config validation rejects incomplete or incorrectly typed shared values", () => {
  assert.equal(readConfig(null), null);
  assert.equal(readConfig({ folder: "/paper", machine: "remote" }), null);
  assert.equal(
    readConfig({ ...config(), engine: { toString: () => "pdflatex" } }),
    null,
  );
  assert.deepEqual(readConfig(config()), config());
});

test("status validation rejects unsafe helper payloads and drops unknown fields", () => {
  assert.throws(() => readStatus({ pid: "123" }), /Invalid status field/);
  assert.throws(() => readStatus({ watching: 1 }), /Invalid status field/);
  assert.throws(() => readStatus({ heartbeat: NaN }), /Invalid status field/);
  assert.deepEqual(readStatus({ watching: true, unknown: "discard" }), {
    watching: true,
  });
});

test("discovery validation checks each document and its metadata", () => {
  reset();
  assert.throws(
    () =>
      readDiscovery({
        ...mock.discovery,
        files: [{ path: "main.tex", main: "yes" }],
      }),
    /Invalid document/,
  );
  assert.throws(
    () => readDiscovery({ ...mock.discovery, method: "unknown" }),
    /Invalid discovery/,
  );
  assert.deepEqual(readDiscovery(mock.discovery), mock.discovery);
});

test("invalid saved projects and picker options are not treated as valid configurations", () => {
  reset();
  mock.shared["latex.folder-projects"] = {
    valid: config(),
    bad: { folder: "" },
  };
  assert.deepEqual(savedProjects(), { valid: config() });
  assert.equal(readPickerOptions({ sessionPicker: true, active: {} }), null);
});

test("theme values are checked before being passed to GPUI color builders", () => {
  reset();
  assert.equal(palette().surface, "#123456");
  mock.colors.surface = "not-a-color";
  assert.throws(() => palette(), /Invalid theme color/);
});
