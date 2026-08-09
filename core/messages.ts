/** Return only the newest patient-written portion of a plain-text email reply. */
export function latestReplyOnly(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const quotedMarkers = [
    /\nOn [^\n]{1,500}\n(?:[^\n]{1,200}\n){0,2}wrote:\s*\n/i,
    /\nOn [^\n]{1,500}?wrote:\s*\n/i,
    /\sOn [^\n]{1,500}?wrote:\s*(?=>)/i,
    /\n-{2,}\s*Original Message\s*-{2,}\s*\n/i,
    /\nFrom:\s.+\nSent:\s.+\nTo:\s.+\nSubject:\s.+/i,
  ];

  let cutAt = text.length;
  for (const marker of quotedMarkers) {
    const match = marker.exec(text);
    if (match && match.index < cutAt) cutAt = match.index;
  }

  return text
    .slice(0, cutAt)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .trim();
}
