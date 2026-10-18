import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ConfirmationCard } from "../src/card";

describe("approval input rendering", () => {
  it("shows each line and its commercial fields as escaped text before confirming", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const responses: unknown[] = [];
    try {
      act(() => root.render(<ConfirmationCard
        proposal={{
          proposalId: "p_1", actionName: "create_order", label: "Create order",
          description: "Place these items", risk: "high", uiConfirmationRequired: true,
          expiresAt: "2099-01-01T00:00:00Z", inputSchema: {},
          input: {
            items: [
              { productName: "<img src=x onerror=alert(1)>", quantity: 2, unitPrice: 1500, totalPrice: 3000 },
              { productName: "Baguette", quantity: 1, unitPrice: 0, totalPrice: 0 },
            ],
            currency: "NGN", paymentTerms: "net_7", deliveryFee: 500,
          },
        }}
        onRespond={(...args) => responses.push(args)}
      />));
      expect(container.querySelectorAll("ol > li")).toHaveLength(2);
      expect(container.textContent).toContain("Unit price: 1500; Total price: 3000");
      expect(container.textContent).toContain("Unit price: 0; Total price: 0");
      expect(container.textContent).toContain("NGN");
      expect(container.textContent).toContain("net_7");
      expect(container.textContent).toContain("500");
      expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
      expect(container.querySelector("img")).toBeNull();
      expect(responses).toEqual([]);
      act(() => (container.querySelectorAll("button")[1] as HTMLButtonElement).click());
      expect(responses).toEqual([["p_1", true]]);
    } finally {
      act(() => root.unmount());
    }
  });
});
