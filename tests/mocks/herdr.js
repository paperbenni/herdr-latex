/** @typedef {import("../../mods/latex/contracts.js").Config} Config */
/** @typedef {import("../../mods/latex/contracts.js").Status} Status */
/** @typedef {import("../../mods/latex/contracts.js").Discovery} Discovery */
/** @typedef {NonNullable<ReturnType<typeof import("herdr").focused>>} Focus */

/** @param {Partial<Config>} [overrides] @returns {Config} */
export function config(overrides = {}) {
  return {
    machine: "remote",
    folder: "/paper",
    tex: "main.tex",
    pdf: "",
    engine: "pdflatex",
    ...overrides,
  };
}
/** @param {Partial<import("herdr").TabInfo>} [overrides] @returns {import("herdr").TabInfo} */
export function tab(overrides = {}) {
  return {
    id: "remote-tab",
    index: 1,
    name: "1",
    named: false,
    active: true,
    status: null,
    panes: 1,
    zoomed: false,
    settled: false,
    settled_at: null,
    changed_at: null,
    working_since: null,
    ...overrides,
  };
}
/** @param {Partial<import("herdr").SpaceInfo>} [overrides] @returns {import("herdr").SpaceInfo} */
export function space(overrides = {}) {
  return {
    id: "remote-space",
    index: 1,
    name: "Paper",
    folder: "/stale",
    machine: "remote",
    named: true,
    branch: null,
    active: true,
    status: null,
    tabs: [tab()],
    ...overrides,
  };
}
/** @param {Partial<import("herdr").PaneInfo>} [overrides] @returns {import("herdr").PaneInfo} */
export function pane(overrides = {}) {
  return {
    pane: "remote-pane",
    terminal: "remote/t1",
    tab: "remote-tab",
    title: "Shell",
    cwd: "/paper",
    branch: null,
    status: null,
    app: null,
    focused: true,
    zoomed: false,
    movable: true,
    program: {
      key: "shell",
      name: "Shell",
      icon: null,
      tint: false,
      tile: null,
      color: null,
      shell: true,
      agent: false,
    },
    ...overrides,
  };
}

export const mock = {
  /** @type {Record<string, unknown>} */ shared: {},
  /** @type {Record<string, unknown>} */ props: {},
  /** @type {Focus} */ focus: {
    space: "remote-space",
    tab: "remote-tab",
    pane: "remote-pane",
    terminal: "remote/t1",
    shown: null,
    agent: null,
    cwd: "/paper",
  },
  spaces: [space()],
  panes: [pane()],
  /** @type {Status} */ status: {},
  /** @type {Discovery} */ discovery: {
    files: [],
    folder: "/paper",
    truncated: false,
    reason: "",
    directories: 1,
    errors: [],
    search: "",
    method: "walk",
  },
  /** @type {Array<{name: string, args: unknown}>} */ calls: [],
  /** @type {Record<string, string>} */ colors: {},
  /** @type {unknown} */ tree: {
    id: "root",
    children: [{ id: "sidebar", size: { px: 268 } }],
  },
};

export function reset() {
  mock.shared = {};
  mock.props = {};
  mock.calls = [];
  mock.status = {};
  mock.focus = {
    space: "remote-space",
    tab: "remote-tab",
    pane: "remote-pane",
    terminal: "remote/t1",
    shown: null,
    agent: null,
    cwd: "/paper",
  };
  mock.spaces = [space()];
  mock.panes = [pane()];
  mock.discovery = {
    files: [],
    folder: "/paper",
    truncated: false,
    reason: "",
    directories: 1,
    errors: [],
    search: "",
    method: "walk",
  };
  mock.colors = Object.fromEntries(
    [
      "surface",
      "raised",
      "solid",
      "border",
      "input",
      "solid_foreground",
      "foreground",
      "muted",
      "accent",
      "background",
      "hover",
      "dim",
      "popover",
      "selected",
      "blocked",
      "done",
      "canvas",
    ].map((key) => [key, "#123456"]),
  );
  mock.tree = { id: "root", children: [{ id: "sidebar", size: { px: 268 } }] };
}

export const focused = () => mock.focus;
export const spaces = () => mock.spaces;
export const panes = () => mock.panes;
export const home = () => "/local/home";
export const appHome = () => "/app";
export const props = () => mock.props;
export const theme = () => mock.colors;
export const layout = () => mock.tree;
/** @param {string} key */
export const shared = (key) => mock.shared[key];
/** @param {string} key @param {unknown} value */
export function setShared(key, value) {
  mock.shared[key] = value;
  return null;
}
/** @param {string} name @param {unknown} [args] */
export function run(name, args) {
  mock.calls.push({ name, args });
  return null;
}
/** @param {string} id */
export function closeOverlay(id) {
  mock.calls.push({ name: "close", args: id });
}
/** @param {unknown} options */
export function openOverlay(options) {
  mock.calls.push({ name: "popup", args: options });
  return "popup-id";
}
/** @returns {Promise<string>} */
export function nextCommand() {
  return new Promise(() => {});
}
/** @param {string} _path @returns {Promise<string>} */
export async function readTextFile(_path) {
  return JSON.stringify(mock.status);
}
/** @param {string} _command @param {string[]} args @returns {Promise<import("herdr").ExecResult>} */
export async function exec(_command, args) {
  const action = args[1];
  const result =
    action === "status"
      ? { status: mock.status, status_file: "/state/status.json" }
      : action === "discover"
        ? mock.discovery
        : { directory: "/state", status_file: "/state/status.json" };
  mock.calls.push({ name: "exec", args });
  return { code: 0, stdout: JSON.stringify(result), stderr: "" };
}
