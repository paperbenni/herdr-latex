import { shared, theme } from "herdr";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {import("./contracts.js").Config | null} */
export function readConfig(value) {
  if (
    !isRecord(value) ||
    typeof value.folder !== "string" ||
    !value.folder ||
    typeof value.machine !== "string"
  )
    return null;
  const { engine, tex, pdf } = value;
  if (
    (engine !== "pdflatex" && engine !== "lualatex" && engine !== "xelatex") ||
    typeof tex !== "string" ||
    typeof pdf !== "string"
  )
    return null;
  return { machine: value.machine, folder: value.folder, tex, pdf, engine };
}

/** @returns {import("./contracts.js").Config | null} */
export function activeSession() {
  return readConfig(shared("latex.active-session"));
}

/** @returns {Partial<Record<string, import("./contracts.js").Config>>} */
export function savedProjects() {
  const value = shared("latex.folder-projects");
  /** @type {Record<string, import("./contracts.js").Config>} */
  const projects = {};
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const config = readConfig(item);
      if (config) projects[key] = config;
    }
  }
  return projects;
}

/** @param {unknown} value @returns {import("./contracts.js").Status} */
export function readStatus(value) {
  if (!isRecord(value)) throw new Error("Invalid LaTeX status response.");
  /** @type {import("./contracts.js").Status} */
  const status = {};
  for (const key of /** @type {const} */ ([
    "phase",
    "error",
    "build_log",
    "preview_path",
    "remote_pdf",
    "worker_version",
  ])) {
    const field = value[key];
    if (field !== undefined) {
      if (typeof field !== "string")
        throw new Error(`Invalid status field: ${key}`);
      status[key] = field;
    }
  }
  for (const key of /** @type {const} */ ([
    "building",
    "watching",
    "cancelled",
  ])) {
    const field = value[key];
    if (field !== undefined) {
      if (typeof field !== "boolean")
        throw new Error(`Invalid status field: ${key}`);
      status[key] = field;
    }
  }
  for (const key of /** @type {const} */ (["heartbeat", "updated"])) {
    const field = value[key];
    if (field !== undefined) {
      if (typeof field !== "number" || !Number.isFinite(field))
        throw new Error(`Invalid status field: ${key}`);
      status[key] = field;
    }
  }
  for (const key of /** @type {const} */ (["pid", "build_code"])) {
    const field = value[key];
    if (field !== undefined) {
      if (
        field !== null &&
        (typeof field !== "number" || !Number.isInteger(field))
      )
        throw new Error(`Invalid status field: ${key}`);
      status[key] = field;
    }
  }
  return status;
}

/** @param {unknown} value @returns {import("./contracts.js").ActionReply} */
export function readActionReply(value) {
  if (
    !isRecord(value) ||
    typeof value.status_file !== "string" ||
    typeof value.directory !== "string"
  )
    throw new Error("Invalid LaTeX helper response.");
  return { directory: value.directory, status_file: value.status_file };
}

/** @param {unknown} value @returns {import("./contracts.js").StatusReply} */
export function readStatusReply(value) {
  if (!isRecord(value) || typeof value.status_file !== "string")
    throw new Error("Invalid LaTeX status response.");
  return { status_file: value.status_file, status: readStatus(value.status) };
}

/** @param {unknown} value @returns {import("./contracts.js").Discovery} */
export function readDiscovery(value) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.errors) ||
    typeof value.folder !== "string" ||
    typeof value.truncated !== "boolean" ||
    typeof value.reason !== "string" ||
    typeof value.directories !== "number" ||
    typeof value.search !== "string"
  )
    throw new Error("Invalid document discovery response.");
  const method = value.method;
  if (method !== "git" && method !== "walk" && method !== "skipped")
    throw new Error("Invalid discovery method.");
  /** @type {import("./contracts.js").Document[]} */
  const files = value.files.map((/** @type {unknown} */ item) => {
    if (
      !isRecord(item) ||
      typeof item.path !== "string" ||
      typeof item.main !== "boolean"
    )
      throw new Error("Invalid document entry.");
    return { path: item.path, main: item.main };
  });
  const errors = value.errors.map((/** @type {unknown} */ item) => {
    if (typeof item !== "string") throw new Error("Invalid discovery error.");
    return item;
  });
  return {
    files,
    errors,
    folder: value.folder,
    truncated: value.truncated,
    reason: value.reason,
    directories: value.directories,
    search: value.search,
    method,
    ...(value.skipped === "broad-folder"
      ? { skipped: /** @type {const} */ ("broad-folder") }
      : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}

/** @param {unknown} value @returns {import("./contracts.js").PickerOptions | null} */
export function readPickerOptions(value) {
  if (
    !isRecord(value) ||
    value.sessionPicker !== true ||
    !isRecord(value.current)
  )
    return null;
  const active = readConfig(value.active);
  if (
    !active ||
    typeof value.current.machine !== "string" ||
    typeof value.current.folder !== "string"
  )
    return null;
  return {
    sessionPicker: true,
    current: { machine: value.current.machine, folder: value.current.folder },
    active,
    building: value.building === true,
    ...(typeof value.overlay === "string" ? { overlay: value.overlay } : {}),
  };
}

/**
 * Herdr declares theme values as strings; GPUI requires hexadecimal colors.
 * Validate this boundary instead of weakening the generated GPUI declarations.
 * @returns {Record<string, import("./contracts.js").HexColor>}
 */
export function palette() {
  /** @type {Record<string, import("./contracts.js").HexColor>} */
  const colors = {};
  for (const [name, color] of Object.entries(theme())) {
    if (!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color))
      throw new Error(`Invalid theme color: ${name}`);
    colors[name] = /** @type {import("./contracts.js").HexColor} */ (color);
  }
  return colors;
}
