import assert from "node:assert/strict";
import { test } from "node:test";
import {
  currentSource,
  projectConfig,
  sourceKey,
  sameFolder,
} from "../session.js";
import { mock, reset, config } from "../../../tests/mocks/herdr.js";

test("project preferences win over active-preview settings and stay scoped to their source", () => {
  reset();
  const here = { machine: "remote", folder: "/paper" };
  mock.shared["latex.active-session"] = config({ tex: "active.tex" });
  assert.equal(projectConfig(here).tex, "active.tex");
  mock.shared["latex.folder-projects"] = {
    [sourceKey(here)]: config({ tex: "chosen.tex", engine: "xelatex" }),
  };
  assert.equal(projectConfig(here).tex, "chosen.tex");
  assert.equal(projectConfig(here).engine, "xelatex");
  assert.equal(projectConfig({ ...here, machine: "other" }).tex, "");
  assert.equal(projectConfig({ ...here, folder: "/other" }).engine, "pdflatex");
});

test("folder identity is shared across navigation and activity without changing preference keys", () => {
  assert.equal(sameFolder(config(), config({ folder: "/paper/" })), true);
  assert.equal(sameFolder(config(), config({ machine: "other" })), false);
  assert.notEqual(
    sourceKey(config()),
    sourceKey(config({ folder: "/paper/" })),
  );
});

test("source resolution falls back to the active tab then the space folder", () => {
  reset();
  mock.focus.cwd = null;
  mock.focus.tab = "missing-tab";
  assert.deepEqual(currentSource(), { machine: "remote", folder: "/paper" });
  mock.panes = [];
  assert.deepEqual(currentSource(), { machine: "remote", folder: "/stale" });
});
