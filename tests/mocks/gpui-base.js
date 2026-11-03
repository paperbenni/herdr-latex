import { Element } from "./gpui-kit.js";
export const h_flex = () => new Element();
export const v_flex = () => new Element();
export class InputState {
  /** @type {Map<string, (event: import("gpui-base").InputEvent, cx: import("gpui-kit").Context) => void>} */ handlers =
    new Map();
  /** @param {{value?: string, placeholder?: string}} [options] */
  constructor(options = {}) {
    this.text = options.value || "";
  }
  /** @param {{value?: string, placeholder?: string}} [options] */
  static new(options) {
    return new InputState(options);
  }
  value() {
    return this.text;
  }
  /** @param {string} next */
  set_value(next) {
    this.text = next;
  }
  /** @param {string} name @param {(event: import("gpui-base").InputEvent, cx: import("gpui-kit").Context) => void} handler */
  on(name, handler) {
    this.handlers.set(name, handler);
    return true;
  }
  focus() {}
}
export const Input = { new: () => new Element() };
