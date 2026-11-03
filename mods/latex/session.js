import { focused, home, panes, spaces } from "herdr";
import { activeSession, savedProjects } from "./model.js";

/** The panel and retained toolbar must resolve the same live project.
 * @returns {import("./contracts.js").Source}
 */
export function currentSource() {
  const focus = focused();
  const space = spaces().find((s) => s.id === focus?.space);
  const machine = space?.machine || "";
  const tab =
    space?.tabs.find((t) => t.id === focus?.tab) ||
    space?.tabs.find((t) => t.active);
  const live = panes().find((p) => p.tab === tab?.id && p.cwd);
  return {
    machine,
    folder:
      focus?.cwd || live?.cwd || space?.folder || (machine ? "~" : home()),
  };
}

/** Stable preference key; retain the original folder spelling for persisted data.
 * @param {import("./contracts.js").Source} source
 */
export const sourceKey = (source) =>
  JSON.stringify([source.machine || "", source.folder]);

/** @param {import("./contracts.js").Config} config */
export const configKey = (config) =>
  JSON.stringify([
    config.machine || "",
    config.folder,
    config.tex,
    config.pdf,
    config.engine,
  ]);

/** @param {string | null | undefined} path */
export const normalizedPath = (path) =>
  (path || "").replace(/\\/g, "/").replace(/\/+$/, "");

/** Folder identity used for activity and navigation; preferences retain their stable keys.
 * @param {import("./contracts.js").Source | null | undefined} current
 * @param {import("./contracts.js").Source | null | undefined} active
 */
export function sameFolder(current, active) {
  return Boolean(
    current &&
    active &&
    (current.machine || "") === (active.machine || "") &&
    normalizedPath(current.folder) === normalizedPath(active.folder),
  );
}

/** @param {import("./contracts.js").Status | undefined} status @param {number} [now] */
export function isActive(status, now = Date.now() / 1000) {
  return Boolean(
    status?.pid &&
    status.heartbeat &&
    now - status.heartbeat < 180 &&
    (status.building || status.watching),
  );
}

/** Restore folder preferences consistently on open and context changes.
 * @param {import("./contracts.js").Source} source
 * @returns {import("./contracts.js").Config}
 */
export function projectConfig(source) {
  const previous = activeSession();
  /** @type {Partial<import("./contracts.js").Config>} */
  const saved =
    savedProjects()[sourceKey(source)] ||
    (previous && sourceKey(previous) === sourceKey(source) ? previous : {});
  return { tex: "", pdf: "", engine: "pdflatex", ...saved, ...source };
}
