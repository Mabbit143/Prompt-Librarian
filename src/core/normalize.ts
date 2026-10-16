import { createHash } from "node:crypto";

/**
 * Identity normalization for exact-duplicate checks: Unicode NFC, line endings, and surrounding whitespace only.
 * Wording, case, internal spacing and Markdown are untouched (classify-prompts-ideas: "may ignore surrounding
 * whitespace and purely presentational Markdown, but not wording"). Presentational Markdown is not stripped.
 */
export function normalizeContent(text: string): string {
  return text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

export const contentHash = (text: string): string =>
  createHash("sha256").update(normalizeContent(text)).digest("hex");

const shingles = (text: string, n = 3): Set<string> => {
  const w = normalizeContent(text).toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  if (out.size === 0) w.forEach((x) => out.add(x));
  return out;
};

/** Jaccard similarity of word 3-shingles, 0..1. Candidate signal only; never authorizes a merge. */
export function similarity(a: string, b: string): number {
  const A = shingles(a), B = shingles(b);
  let inter = 0;
  for (const s of A) if (B.has(s)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
