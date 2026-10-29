/**
 * What a confirmation card says (amendment 99): the registry's display hints
 * and the app's own description, made safe to draw.
 */
import { describe, expect, it } from "vitest";

import { appView, fillSummary, hintedView, type ProposalPayload } from "../src/index";

const proposal = (input: Record<string, unknown>, inputSchema: unknown): ProposalPayload => ({
  proposalId: "p1", actionName: "update_product", label: "Change a product", description: "Changes a product.", risk: "medium",
  input, inputSchema, expiresAt: "2099-01-01T00:00:00Z", uiConfirmationRequired: false,
});

const schema = {
  type: "object",
  "x-mihe-summary": "Change {productName}",
  properties: {
    productId: { type: "string", "x-mihe-hidden": true },
    productName: { type: "string", title: "Product" },
    price: { type: "number", title: "Price", "x-mihe-format": "money" },
    forSale: { type: "boolean", title: "For sale", "x-mihe-format": "yesno" },
    photos: { type: "array", title: "Photos", items: { type: "object", properties: { assetId: { type: "string", "x-mihe-hidden": true }, file: { type: "string", title: "File" } } } },
  },
};

describe("the registry's display hints", () => {
  it("shows fields in the schema's order, by their titles, formatted, without the hidden id", () => {
    const v = hintedView(proposal({ forSale: false, price: 13, productName: "Linen Shirt", productId: "abc-123" }, schema));
    expect(v.source).toBe("hints");
    expect(v.summary).toBe("Change Linen Shirt");
    expect(v.lines).toEqual([
      { label: "Product", text: "Linen Shirt" },
      { label: "Price", text: (13).toLocaleString(undefined, { minimumFractionDigits: 2 }) },
      { label: "For sale", text: "No" },
    ]);
    expect(JSON.stringify(v)).not.toContain("abc-123");
  });

  it("lists each entry of a list on its own, with hidden fields left out of each", () => {
    const v = hintedView(proposal({ productName: "Mug", photos: [{ assetId: "a1", file: "mug-front.jpg" }, { assetId: "a2", file: "mug-back.jpg" }] }, schema));
    expect(v.lines[1]).toEqual({ label: "Photos", items: ["mug-front.jpg", "mug-back.jpg"] });
  });

  it("still shows a field the schema doesn't know, so nothing that will run is off the card", () => {
    const v = hintedView(proposal({ productName: "Mug", surprise: "yes" }, schema));
    expect(v.lines.map((l) => l.label)).toEqual(["Product", "Surprise"]);
  });

  it("is today's card when there are no hints", () => {
    const v = hintedView(proposal({ orderId: "o1", reason: "returned" }, { type: "object", properties: { orderId: { type: "string" }, reason: { type: "string" } } }));
    expect(v).toEqual({ source: "plain", lines: [{ label: "Order id", text: "o1" }, { label: "Reason", text: "returned" }] });
  });

  it("drops a summary that names a field the input doesn't have", () => {
    expect(fillSummary("Change {productName}", {}, {})).toBeNull();
    expect(fillSummary("Make {products} products", { products: [1, 2, 3] }, {})).toBe("Make 3 products");
  });
});

describe("the app's description", () => {
  it("keeps only plain words and picture addresses that can't run anything", () => {
    const v = appView({
      summary: "Make 3 products", confirmLabel: "Make 3 products", note: "All start as drafts.",
      lines: [{ label: "Amber Candle", text: "$18", before: "$12", images: [{ src: "https://cdn.example/a.webp", alt: "jar" }, { src: "javascript:alert(1)" }, { src: "data:text/html,<b>x</b>" }, { src: "data:image/png;base64,AAAA" }] }],
    });
    expect(v).toEqual({
      source: "app", summary: "Make 3 products", confirmLabel: "Make 3 products", note: "All start as drafts.",
      lines: [{ label: "Amber Candle", text: "$18", before: "$12", images: [{ src: "https://cdn.example/a.webp", alt: "jar" }, { src: "data:image/png;base64,AAAA" }] }],
    });
  });
});
