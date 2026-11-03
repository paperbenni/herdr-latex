/** Minimal element recorder: native styles are checked by the real API typings. */
export class Element {
  idValue = "";
  /** @type {unknown[]} */ nodes = [];
  /** @type {((event: unknown, cx: import("gpui-kit").Context) => void) | undefined} */ click;
  constructor() {
    const proxy = new Proxy(this, {
      get(target, key, receiver) {
        if (key === "then") return undefined;
        if (key in target) return Reflect.get(target, key, receiver);
        return () => proxy;
      },
    });
    return proxy;
  }
  /** @param {string} id */
  id(id) {
    this.idValue = id;
    return this;
  }
  /** @param {unknown} node */
  child(node) {
    this.nodes.push(node);
    return this;
  }
  /** @param {unknown[]} nodes */
  children(nodes) {
    this.nodes.push(...nodes);
    return this;
  }
  /** @param {unknown} condition @param {(element: Element) => Element} transform */
  when(condition, transform) {
    return condition ? transform(this) : this;
  }
  /** @param {(event: unknown, cx: import("gpui-kit").Context) => void} handler */
  on_click(handler) {
    this.click = handler;
    return this;
  }
}
export class View {}
export const div = () => new Element();
/** @param {string} _path */
export const svg = (_path) => new Element();

/** @param {unknown} root @param {string} id @returns {Element | undefined} */
export function findElement(root, id) {
  if (!(root instanceof Element)) return undefined;
  if (root.idValue === id) return root;
  for (const node of root.nodes) {
    const result = findElement(node, id);
    if (result) return result;
  }
  return undefined;
}
/** @param {unknown} root @returns {string} */
export function textContent(root) {
  return root instanceof Element
    ? root.nodes.map(textContent).join(" ")
    : typeof root === "string"
      ? root
      : "";
}
