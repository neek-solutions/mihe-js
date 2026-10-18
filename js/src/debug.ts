/**
 * The developer's view of what each screen costs (amendment 67).
 *
 * With `debug` on the provider, the runtime reports what one answer on the
 * current screen re-sends to the model, and this turns that report into a
 * console line someone can act on: which part is large, and which tools make
 * it so. Estimates, about four characters a token. The dashboard's usage
 * page has the real bill.
 */

import type { ContextSize, ScreenId } from "@mihe-dev/protocol";

export interface ContextReport {
  screenId?: ScreenId;
  chat: ContextSize;
  voice?: ContextSize;
}

/** How many of the largest tools to name. The rest are counted. */
const LARGEST = 5;

export function formatContextReport(report: ContextReport): string {
  const where = report.screenId ? `\`${report.screenId}\`` : "an unregistered page";
  const lines = [`[mihe] Each answer on ${where} re-sends about:`];
  lines.push(`  typed: ${describe(report.chat)}`);
  if (report.voice) lines.push(`  voice: ${describe(report.voice)}`);

  const largest = (report.voice ?? report.chat).tools.slice(0, LARGEST);
  if (largest.length > 0) {
    lines.push(
      `  largest tools: ${largest.map((tool) => `${tool.name} ${tool.tokens}`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

function describe(size: ContextSize): string {
  const total = size.instructionTokens + size.toolTokens + size.screenTokens;
  return (
    `${total.toLocaleString("en")} tokens — instructions ${size.instructionTokens}, ` +
    `${size.tools.length} tools ${size.toolTokens}, this screen ${size.screenTokens}`
  );
}
