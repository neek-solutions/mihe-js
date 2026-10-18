/**
 * How a proposal's input reads on the approval card, for every card Mihe
 * draws: the web component's and the React SDK's.
 *
 * One copy, because the card is the last thing a user reads before approving
 * something consequential, and two copies would drift in exactly the place
 * where "what they were shown" has to mean one thing.
 */

/**
 * Render one field of a proposal for a person to read.
 *
 * This is the last thing a user sees before approving something consequential,
 * so `JSON.stringify` is not good enough — it was showing
 * `[{"productName":"Chocolate Protein Loaf","quantity":3}]` where the sentence
 * "3 × Chocolate Protein Loaf" was wanted. Someone who cannot read the card
 * cannot meaningfully consent to what it describes.
 *
 * Values still come entirely from the schema-validated input, never from model
 * prose, so this changes how the payload is *shown* and not what it can say.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatValue).join(", ") || "—";
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);

    // A quantity paired with a name is common enough — order lines, stock
    // adjustments, recipe amounts — to be worth reading as one.
    const quantity = entries.find(([key]) => /^(quantity|qty|count)$/i.test(key));
    // An id is not a product name. Only compact a labelled quantity; all
    // remaining fields still have to be visible before the user consents.
    const name = entries.find(([key, nested]) =>
      /(?:name|title|label)$|^(?:product|item)$/i.test(key) &&
      typeof nested === "string",
    );
    if (quantity && name) {
      const details = entries
        .filter(([key]) => key !== quantity[0] && key !== name[0])
        .map(([key, nested]) => `${humanizeKey(key)}: ${formatValue(nested)}`);
      return [
        `${formatValue(quantity[1])} × ${formatValue(name[1])}`,
        ...details,
      ].join("; ");
    }

    return entries
      .map(([key, nested]) => `${humanizeKey(key)}: ${formatValue(nested)}`)
      .join(", ");
  }

  return String(value);
}

/** `productName` and `order_number` both become "Product name". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
