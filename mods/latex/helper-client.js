import { appHome, exec, readTextFile } from "herdr";
import { isRecord, readStatus, readStatusReply } from "./model.js";

/** JSON and process failure handling for every frontend helper request.
 * @param {import("./contracts.js").HelperAction} action
 * @param {import("./contracts.js").Config} config
 * @param {string} [search]
 * @returns {Promise<unknown>}
 */
export async function callHelper(action, config, search = "") {
  const result = await exec("python3", [
    `${appHome()}/mods/latex/helper.py`,
    action,
    "--config",
    JSON.stringify(config),
    "--search",
    search,
  ]);
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      result.stderr || result.stdout || "The LaTeX helper did not reply.",
    );
  }
  const error =
    isRecord(data) && typeof data.error === "string" ? data.error : "";
  if (result.code !== 0 || error)
    throw new Error(error || result.stderr || "LaTeX helper failed.");
  return data;
}

/** @param {string} file @returns {Promise<import("./contracts.js").Status>} */
export async function readStatusFile(file) {
  const content = await readTextFile(file);
  return content ? readStatus(JSON.parse(content)) : {};
}

/** @param {import("./contracts.js").Config} config */
export async function queryStatus(config) {
  return readStatusReply(await callHelper("status", config));
}
