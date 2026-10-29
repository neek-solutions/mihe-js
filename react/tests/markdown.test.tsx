import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Markdown } from "../src/markdown";

describe("a reply's Markdown in the React panel", () => {
  it("shows bold and lists without their markers, and HTML only as text", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() => root.render(<Markdown text={"I changed **two things**:\n- the title\n- <b>the price</b>"} />));
      expect(container.textContent).not.toContain("**");
      expect(container.querySelector("strong")?.textContent).toBe("two things");
      expect(container.querySelectorAll("ul > li")).toHaveLength(2);
      // A host's CSS reset must not take the bullets away.
      expect((container.querySelector("ul") as HTMLElement).style.listStyleType).toBe("disc");
      expect(container.querySelector("b")).toBeNull();
      expect(container.textContent).toContain("<b>the price</b>");
    } finally {
      act(() => root.unmount());
    }
  });
});
