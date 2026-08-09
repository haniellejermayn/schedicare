/**
 * Pure mail-text helpers with ZERO imports — this module sits below both the
 * agents layer and the integrations layer, so either side may use it without
 * creating an import cycle (agents/tools → core/scheduling →
 * integrations/factory → mail/google → agents/comms → agents/tools was a
 * real TDZ crash).
 *
 * Mail clients render plain text verbatim, so hard-wrapped model output shows
 * premature mid-paragraph line breaks. Collapse single newlines inside a
 * paragraph to spaces while preserving structure: blank-line paragraph
 * breaks, list items, phone-shaped lines, FULL-line sign-offs
 * ("Warm regards,"), clinic/team name lines, ":" labels, and the greeting.
 */
export function normalizeMailBody(body: string): string {
  const LISTY = /^\s*([-*\u2022]|\d+[).:]\s)/;
  const PHONEY = /^\(?\+?\d[\d\s().-]{5,}$/;
  const FULL_SIGNOFF =
    /^(warm regards|kind regards|regards|salamat( po)?|sincerely|best regards|best|thank you|thanks|see you( then)?)[,!. ]*$/i;
  const NAMEY = /clinic|care team/i;
  const keeps = (line: string) =>
    LISTY.test(line) ||
    PHONEY.test(line.trim()) ||
    FULL_SIGNOFF.test(line.trim()) ||
    NAMEY.test(line);
  return body
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n");
      let out = lines[0]?.trimEnd() ?? "";
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const prev = lines[i - 1] ?? "";
        const keep =
          keeps(line) ||
          keeps(prev) ||
          /:\s*$/.test(out) ||
          /^(hi|hello|dear)\b.*,\s*$/i.test(prev) ||
          line.trim() === "";
        out += keep ? "\n" + line.trimEnd() : " " + line.trim();
      }
      return out;
    })
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n");
}
