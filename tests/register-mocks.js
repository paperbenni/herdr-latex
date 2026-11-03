import { registerHooks } from "node:module";

const mocks = new Map([
  ["herdr", new URL("./mocks/herdr.js", import.meta.url).href],
  ["gpui-kit", new URL("./mocks/gpui-kit.js", import.meta.url).href],
  ["gpui-base", new URL("./mocks/gpui-base.js", import.meta.url).href],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = mocks.get(specifier);
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
  },
});
