import "@testing-library/jest-dom/vitest";

/**
 * A Storage shim, because Node 26 took localStorage away from these tests.
 *
 * Measured on node v26.7.0 with jsdom 29.1.1: inside a test, both
 * `localStorage` and `window.localStorage` are undefined, and node prints
 * "localStorage is not available because --localstorage-file was not
 * provided". jsdom itself is fine — `new JSDOM(...).window.localStorage` is a
 * Storage object.
 *
 * The culprit is node's own experimental localStorage. `node -e` with no flags
 * shows a get/set accessor already installed on globalThis whose getter
 * returns undefined; pass --localstorage-file and the same accessor starts
 * returning a Storage. Either way it is there first, and it shadows the one
 * vitest would otherwise expose from the jsdom window.
 *
 * So this is a Node-version regression, not an application or jsdom bug, and
 * the four widget-state tests it broke were failing long before anyone noticed.
 * Installed only when the global is genuinely missing, so a runtime that does
 * provide one keeps its own.
 *
 * The alternative was passing --localstorage-file to node, which makes the
 * suite write a real file and share it between runs. An in-memory Storage
 * cannot leak state across runs, which is what a test wants.
 */
if (typeof globalThis.localStorage === "undefined") {
  class MemoryStorage implements Storage {
    #items = new Map<string, string>();

    get length() {
      return this.#items.size;
    }

    key(index: number) {
      return [...this.#items.keys()][index] ?? null;
    }

    getItem(key: string) {
      return this.#items.get(String(key)) ?? null;
    }

    setItem(key: string, value: string) {
      // Stringified on the way in, as the real Storage does: the widget
      // persists JSON, but a test that stores a number should read back "1".
      this.#items.set(String(key), String(value));
    }

    removeItem(key: string) {
      this.#items.delete(String(key));
    }

    clear() {
      this.#items.clear();
    }

    [name: string]: unknown;
  }

  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
