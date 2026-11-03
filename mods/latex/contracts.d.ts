export type Engine = "pdflatex" | "lualatex" | "xelatex";
export type HelperAction =
  | "compile"
  | "build-preview"
  | "preview"
  | "refresh"
  | "stop"
  | "status"
  | "discover";
export type WorkAction = Exclude<HelperAction, "status" | "discover">;
export type InputKey = "tex" | "pdf" | "search";
export type HexColor = `#${string}`;
export interface Source {
  machine: string;
  folder: string;
}
export interface Config extends Source {
  tex: string;
  pdf: string;
  engine: Engine;
}
export interface Document {
  path: string;
  main: boolean;
}
export interface Discovery {
  files: Document[];
  folder: string;
  truncated: boolean;
  reason: string;
  directories: number;
  errors: string[];
  search: string;
  method: "git" | "walk" | "skipped";
  skipped?: "broad-folder";
  message?: string;
}
export interface Status {
  preview_path?: string;
  stamp?: number[];
  updated?: number;
  remote_pdf?: string;
  build_code?: number | null;
  build_log?: string;
  pid?: number | null;
  worker_version?: string;
  watching?: boolean;
  building?: boolean;
  phase?: string;
  error?: string;
  heartbeat?: number;
  cancelled?: boolean;
}
export interface ActionReply {
  directory: string;
  status_file: string;
}
export interface StatusReply {
  status: Status;
  status_file: string;
}
export interface PickerOptions {
  sessionPicker: true;
  current: Source;
  active: Config;
  building: boolean;
  overlay?: string;
}
export interface ToolbarContext {
  current: Source;
  session: Config | null;
  compact: boolean;
}
