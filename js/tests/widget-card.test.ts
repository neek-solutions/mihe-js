/** The web component's confirmation card, drawing a card's view (amendment 99). */
import { describe, expect, it, vi } from "vitest";

import { appView, hintedView, type ProposalPayload } from "../src/index";
import { confirmationCard } from "../src/widget/card";

const proposal: ProposalPayload = {
  proposalId: "p1", actionName: "update_product", label: "Change a product", description: "Changes a product.", risk: "medium",
  input: { productId: "abc-123", productName: "Linen Shirt", price: 13 },
  inputSchema: { type: "object", "x-mihe-summary": "Change {productName}", properties: { productId: { type: "string", "x-mihe-hidden": true }, productName: { type: "string", title: "Product" }, price: { type: "number", title: "Price" } } },
  expiresAt: "2099-01-01T00:00:00Z", uiConfirmationRequired: false,
};
const confirm = (el: HTMLElement) => [...el.querySelectorAll("button")].at(-1) as HTMLButtonElement;

describe("the web component's card", () => {
  it("can't be confirmed while the app is still describing it", () => {
    const respond = vi.fn();
    const el = confirmationCard(proposal, respond, "pending");
    expect(el.textContent).toContain("Checking the details");
    expect(confirm(el).disabled).toBe(true);
    confirm(el).click();
    expect(respond).not.toHaveBeenCalled();
  });

  it("draws the hints: the summary, titled fields, no hidden id, the description under More", () => {
    const el = confirmationCard(proposal, vi.fn(), hintedView(proposal));
    expect(el.querySelector(".card-summary")?.textContent).toBe("Change Linen Shirt");
    expect([...el.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Product", "Price"]);
    expect(el.textContent).not.toContain("abc-123");
    expect(el.querySelector("details")?.textContent).toContain("Changes a product.");
  });

  it("draws the app's lines: before and after, thumbnails, its own button words; text stays text", () => {
    const respond = vi.fn();
    const el = confirmationCard(proposal, respond, appView({
      confirmLabel: "Change price", lines: [{ label: "Price", before: "$12.00", text: "$13.00 <b>x</b>", images: [{ src: "https://cdn.example/shirt.webp", alt: "shirt" }] }],
    }));
    expect(el.querySelector("s")?.textContent).toBe("$12.00");
    expect(el.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/shirt.webp");
    expect(el.querySelector("b")).toBeNull();
    expect(confirm(el).textContent).toBe("Change price");
    confirm(el).click();
    expect(respond).toHaveBeenCalledWith("p1", true);
  });

  it("puts pictures beside what they show, and makes a high-risk card's button the danger colour", () => {
    const el = confirmationCard({ ...proposal, risk: "high" }, vi.fn(), appView({ lines: [{ label: "Amber Candle", text: "$18.00", images: [{ src: "https://cdn.example/a.webp" }] }, { label: "Note", text: "plain" }] }));
    const row = el.querySelector(".card-media-row")!;
    expect(row.querySelector("img")).not.toBeNull();
    expect(row.querySelector(".card-media-label")?.textContent).toBe("Amber Candle");
    expect(el.querySelectorAll(".card-row")).toHaveLength(1);
    expect(confirm(el).className).toContain("button-danger");
  });
});

