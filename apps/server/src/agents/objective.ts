import type { InvestigationContext } from "@storewhy/contracts";

// Historical wording stays intact in Context; a scope-only followup changes the model's active horizon.
export function effectiveObjective(
  context: Pick<InvestigationContext, "objective" | "lastQuestion" | "spec">,
): string {
  const question = context.objective ?? context.lastQuestion;
  if (context.spec.mode !== "cohort") return question;
  const windows =
    /(?<![0-9一二三四五六七八九十百])(?:7|14|七|十四)\s*天|\b(?:7|14|seven|fourteen)\s*days?\b|首周|第一周|(?<![0-9一二三四五六七八九十百第])(?:一|两|二|1|2)\s*周|\b(?:first|one|two|1|2)\s*weeks?\b/gi;
  const matches = [...question.matchAll(windows)];
  const horizons = new Set(
    matches.map(([word]) =>
      /14|十四|两|二|fourteen|two|^2/i.test(word) ? 14 : 7,
    ),
  );
  // Never collapse an explicit comparison of two horizons into one supported window.
  if (horizons.size > 1) return question;
  return question.replace(windows, (word, offset: number) => {
    if (/[a-z]/i.test(word)) return `${context.spec.windowDays} days`;
    if (word.includes("周") && !/首访后\s*$/.test(question.slice(0, offset)))
      return `首访后${context.spec.windowDays}天`;
    return `${context.spec.windowDays}天`;
  });
}
