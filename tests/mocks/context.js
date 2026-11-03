/**
 * Implement the framework context used by the views. Unsupported native-only
 * operations fail explicitly rather than silently widening the production API.
 * @returns {{cx: import("gpui-kit").AsyncContext, flush: () => Promise<void>}}
 */
export function context() {
  /** @type {unknown[]} */
  const errors = [];
  const task = { cancel() {}, is_done: () => true };
  const unsupported = () => {
    throw new Error("Native operation is not available in unit tests");
  };
  /** @type {import("gpui-kit").AsyncContext} */
  const cx = {
    notify() {},
    bind_keys: () => 0,
    stop_propagation() {},
    propagate() {},
    phase: () => "task",
    theme: unsupported,
    open_url: unsupported,
    read_from_clipboard: () => undefined,
    write_to_clipboard: unsupported,
    focus_handle: () => ({
      focus() {},
      is_focused: () => false,
      release: () => true,
    }),
    new(Class, options) {
      const child = new Class(options);
      child.init?.(options, cx);
      return {
        set_props(next) {
          child.update?.(next);
        },
        release: () => true,
      };
    },
    spawn(body) {
      Promise.resolve()
        .then(() => body(cx))
        .catch((error) => {
          errors.push(error);
        });
      return task;
    },
    sleep: async () => {},
    timer: { every: () => task, after: () => task },
  };
  return {
    cx,
    async flush() {
      await new Promise((resolve) => setImmediate(resolve));
      if (errors.length) throw errors.shift();
    },
  };
}
