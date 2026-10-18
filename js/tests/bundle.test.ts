/**
 * The single-file builds (doc 08, phase 3), loaded the way a page with no
 * bundler loads them: the classic script defining `window.Mihe`, and the ES
 * module by URL. Built fresh from the source, so this tests what would ship.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it, vi } from "vitest";

let dir: string;

beforeAll(() => {
  // Inside the project: the test runner will not import a module from
  // outside it.
  dir = join(__dirname, "../../node_modules/.cache/mihe-bundle-test");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("node", [join(__dirname, "../../scripts/bundle-js.mjs"), dir], { stdio: "pipe" });
});

class SilentSocket {
  onopen = null;
  onclose = null;
  onerror = null;
  onmessage = null;
  send() {}
  close() {}
}

type Api = typeof import("../src/index");

function exercise(api: Api) {
  vi.stubGlobal("WebSocket", class { constructor() { return new SilentSocket() as never; } });
  const mihe = api.createMihe({
    url: "ws://runtime.test/v1/ws",
    publicKey: "pk_test_0123456789abcdef",
    getUserToken: () => Promise.resolve("jwt"),
  });
  const widget = api.mountWidget(mihe, { form: "classic" });
  expect(widget.element.shadowRoot!.querySelector("button.launcher")).not.toBeNull();
  widget.unmount();
  mihe.destroy();
  vi.unstubAllGlobals();
}

describe("the single files", () => {
  it("are self-contained: no import or require of anything else", () => {
    for (const file of ["mihe.min.js", "mihe.iife.min.js"]) {
      const code = readFileSync(join(dir, file), "utf8");
      expect(code, file).not.toMatch(/\bfrom\s*["'](?!\.)/);
      expect(code, file).not.toMatch(/\brequire\(/);
      expect(code.startsWith("/*! @mihe-dev/js"), file).toBe(true);
    }
  });

  it("the classic script defines Mihe, and it works with nothing else on the page", () => {
    const code = readFileSync(join(dir, "mihe.iife.min.js"), "utf8");
    const api = new Function(`${code}\nreturn Mihe;`)() as Api;
    expect(typeof api.createMihe).toBe("function");
    exercise(api);
  });

  it("the ES module imports by URL and works", async () => {
    const api = (await import(/* @vite-ignore */ pathToFileURL(join(dir, "mihe.min.js")).href)) as Api;
    exercise(api);
  });
});
