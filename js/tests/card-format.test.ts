import { describe, expect, it } from "vitest";

import { formatValue, humanizeKey } from "../src/index";

/**
 * The confirmation card is the last thing a user sees before approving
 * something consequential. Someone who cannot read it cannot meaningfully
 * consent to what it describes, which makes this formatting a correctness
 * concern rather than a cosmetic one.
 */
describe("confirmation card values", () => {
  it("reads an order line as words rather than JSON", () => {
    // What it did before: [{"productName":"Chocolate Protein Loaf","quantity":3}]
    expect(
      formatValue([{ productName: "Chocolate Protein Loaf", quantity: 3 }]),
    ).toBe("3 × Chocolate Protein Loaf");
  });

  it("joins several lines readably", () => {
    expect(
      formatValue([
        { productName: "Sourdough", quantity: 2 },
        { productName: "Baguette", quantity: 1 },
      ]),
    ).toBe("2 × Sourdough, 1 × Baguette");
  });

  it("keeps the price, total, currency and terms when compacting a named quantity", () => {
    expect(formatValue({
      productName: "Sourdough", quantity: 2, unitPrice: 1500,
      totalPrice: 3000, currency: "NGN", terms: { paymentTerms: "net_7" },
    })).toBe("2 × Sourdough; Unit price: 1500; Total price: 3000; Currency: NGN; Terms: Payment terms: net_7");
  });

  it("does not treat an identifier as a readable product name", () => {
    expect(formatValue({ productId: "p_1", quantity: 2, unitPrice: 0 })).toBe(
      "Product id: p_1, Quantity: 2, Unit price: 0",
    );
  });

  it("preserves nested quantities and all zero or false values", () => {
    expect(formatValue({ productName: "Flour", quantity: 5, unit: "kg", discount: 0, taxable: false })).toBe(
      "5 × Flour; Unit: kg; Discount: 0; Taxable: false",
    );
  });

  it("falls back to labelled fields for an object it cannot pattern-match", () => {
    expect(formatValue({ riderName: "Bolt driver", riderPhone: "0801" })).toBe(
      "Rider name: Bolt driver, Rider phone: 0801",
    );
  });

  it("leaves scalars alone", () => {
    expect(formatValue("TLF-0025")).toBe("TLF-0025");
    expect(formatValue(3)).toBe("3");
    expect(formatValue(true)).toBe("true");
    expect(formatValue(null)).toBe("—");
  });

  it("does not render an empty list as empty space", () => {
    // A blank value on a confirmation card reads as "nothing will change",
    // which is the opposite of what an empty items array would mean.
    expect(formatValue([])).toBe("—");
  });

  it("humanises field names in both conventions", () => {
    expect(humanizeKey("orderNumber")).toBe("Order number");
    expect(humanizeKey("delivery_method")).toBe("Delivery method");
  });
});
