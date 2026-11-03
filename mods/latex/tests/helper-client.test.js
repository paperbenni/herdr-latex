import assert from "node:assert/strict";
import { test } from "node:test";
import { callHelper, queryStatus, readStatusFile } from "../helper-client.js";
import { mock, reset, config } from "../../../tests/mocks/herdr.js";

test("helper requests preserve paths as data and pass the requested search", async () => {
  reset();
  const project = config({ folder: "/paper's $(path)", tex: "my slides.tex" });
  await callHelper("discover", project, "slides");
  assert.deepEqual(mock.calls[0], {
    name: "exec",
    args: [
      "/app/mods/latex/helper.py",
      "discover",
      "--config",
      JSON.stringify(project),
      "--search",
      "slides",
    ],
  });
});

test("helper reports non-JSON diagnostics and structured process errors", async () => {
  reset();
  mock.execResult = { code: 1, stdout: "", stderr: "python missing" };
  await assert.rejects(callHelper("discover", config()), /python missing/);
  mock.execResult = {
    code: 0,
    stdout: JSON.stringify({ error: "disconnected" }),
    stderr: "",
  };
  await assert.rejects(callHelper("discover", config()), /disconnected/);
  mock.execResult = { code: 1, stdout: "{}", stderr: "helper failed" };
  await assert.rejects(callHelper("discover", config()), /helper failed/);
});

test("status readers validate both command replies and persisted JSON", async () => {
  reset();
  mock.status = { watching: true, pid: 7 };
  assert.deepEqual((await queryStatus(config())).status, mock.status);
  assert.deepEqual(await readStatusFile("/state/status.json"), mock.status);
  mock.fileContent = "";
  assert.deepEqual(await readStatusFile("/state/status.json"), {});
  mock.fileContent = '{"watching":"true"}';
  await assert.rejects(
    readStatusFile("/state/status.json"),
    /Invalid status field/,
  );
  mock.execResult = { code: 0, stdout: '{"status":{}}', stderr: "" };
  await assert.rejects(queryStatus(config()), /Invalid LaTeX status response/);
});
