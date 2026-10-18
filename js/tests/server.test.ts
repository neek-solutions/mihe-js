// @vitest-environment node

/**
 * Importing the package where there is no DOM, as a server render does.
 *
 * `<mihe-assistant>` extends `HTMLElement`, which a server does not have.
 * Defined on import, the class would throw there and take the whole import
 * with it, so it is defined only when a page first mounts the widget.
 */

import { describe, expect, it } from "vitest";

describe("the package on a server", () => {
  it("imports, and registers nothing", async () => {
    expect(typeof HTMLElement).toBe("undefined");
    const sdk = await import("../src/index");
    expect(typeof sdk.createMihe).toBe("function");
    expect(typeof sdk.mountWidget).toBe("function");
    // Asked for where it cannot exist, it does nothing rather than throw.
    expect(() => sdk.defineMiheAssistant()).not.toThrow();
  });
});
