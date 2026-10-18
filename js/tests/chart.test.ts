import { describe, expect, it } from "vitest";

import { summarise, thin } from "../src/chart";

const p = (x: string, y: number) => ({ x, y });

describe("summarise", () => {
  it("gives the figures a trend is explained by", () => {
    const summary = summarise(
      [p("Jan", 0), p("Feb", 10), p("Mar", 216), p("Apr", 60), p("May", 60)],
      true,
    )!;
    expect(summary.points).toBe(5);
    expect(summary.first).toEqual(p("Jan", 0));
    expect(summary.last).toEqual(p("May", 60));
    expect(summary.max).toEqual(p("Mar", 216));
    expect(summary.min).toEqual(p("Jan", 0));
    expect(summary.total).toBe(346);
    expect(summary.largestRise).toEqual({ from: "Feb", to: "Mar", change: 206 });
    expect(summary.largestFall).toEqual({ from: "Mar", to: "Apr", change: -156 });
  });

  it("finds no rises or falls among categories, which have no order", () => {
    const summary = summarise([p("Rent", 50), p("Fuel", 2), p("Flour", 30)], false)!;
    expect(summary.largestRise).toBeUndefined();
    expect(summary.largestFall).toBeUndefined();
    expect(summary.max).toEqual(p("Rent", 50));
  });

  it("has nothing to say about an empty series", () => {
    expect(summarise([], true)).toBeUndefined();
  });
});

describe("thin", () => {
  it("keeps both ends and spaces the rest evenly", () => {
    const points = Array.from({ length: 100 }, (_, i) => i);
    const thinned = thin(points, 5);
    expect(thinned).toEqual([0, 25, 50, 74, 99]);
  });

  it("leaves a short series alone", () => {
    expect(thin([1, 2, 3], 60)).toEqual([1, 2, 3]);
  });
});
