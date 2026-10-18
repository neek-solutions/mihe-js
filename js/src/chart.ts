/**
 * Chart summaries, worked out where the numbers are (amendment 67, step 4).
 *
 * The model explains a trend from these figures, so it is handed the start,
 * end, high, low, total and largest steps rather than a list to do arithmetic
 * over, which models get wrong.
 */

import type { ChartPoint, ChartStep, SeriesSummary } from "@mihe-dev/protocol";

export function summarise(points: ChartPoint[], ordered: boolean): SeriesSummary | undefined {
  const [first] = points;
  if (!first) return undefined;
  const last = points[points.length - 1]!;

  let min = first;
  let max = first;
  let total = 0;
  let rise: ChartStep | undefined;
  let fall: ChartStep | undefined;

  points.forEach((point, i) => {
    total += point.y;
    if (point.y < min.y) min = point;
    if (point.y > max.y) max = point;
    if (!ordered || i === 0) return;
    const previous = points[i - 1]!;
    const change = point.y - previous.y;
    if (change > 0 && (!rise || change > rise.change)) {
      rise = { from: previous.x, to: point.x, change };
    }
    if (change < 0 && (!fall || change < fall.change)) {
      fall = { from: previous.x, to: point.x, change };
    }
  });

  return {
    points: points.length,
    first,
    last,
    min,
    max,
    total: Math.round(total * 100) / 100,
    ...(rise ? { largestRise: rise } : {}),
    ...(fall ? { largestFall: fall } : {}),
  };
}

/**
 * At most `limit` points, evenly spaced, keeping both ends. The summary
 * already carries the high and low, which thinning could skip.
 */
export function thin<T>(points: T[], limit: number): T[] {
  if (points.length <= limit) return points;
  if (limit <= 1) return points.slice(0, 1);
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, i) => points[Math.round(i * step)]!);
}
