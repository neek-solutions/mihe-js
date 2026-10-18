import { describe, expect, it } from "vitest";

import { formatContextReport } from "../src/debug";

describe("formatContextReport", () => {
  const size = (tools: [string, number][]) => ({
    instructionTokens: 2200,
    toolTokens: tools.reduce((sum, [, tokens]) => sum + tokens, 0),
    screenTokens: 120,
    tools: tools.map(([name, tokens]) => ({ name, tokens })),
  });

  it("names the screen, the total, and the tools that make it large", () => {
    const text = formatContextReport({
      screenId: "orders.list",
      chat: size([["mark_order_delivered", 439], ["navigate", 180]]),
      voice: size([["mark_order_delivered", 439], ["navigate", 180], ["consult_agent", 150]]),
    });

    expect(text).toContain("`orders.list`");
    expect(text).toContain("typed: 2,939 tokens");
    expect(text).toContain("voice: 3,089 tokens");
    expect(text).toContain("largest tools: mark_order_delivered 439, navigate 180, consult_agent 150");
  });

  it("leaves voice out for an app without it", () => {
    const text = formatContextReport({ chat: size([]) });
    expect(text).toContain("an unregistered page");
    expect(text).not.toContain("voice:");
  });
});
