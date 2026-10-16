import type { Classification } from "./taxonomy.js";

type Category = Classification["primary_category"];
// A rule may assert a category, a spec topic tag, or both. Topic-only rules never trigger a disagreement.
type Rule = { name: string; test: RegExp; category?: Category; topic?: string };

// Deterministic, zero-cost filing rules. Extend as approved mappings accumulate.
export const RULES: Rule[] = [
  { name: "funding", test: /\b(scholarship|fellowship|grant)\b/i, topic: "Scholarships & Funding" },
  { name: "reentry", test: /\b(reentry|re-entry|formerly incarcerated)\b/i, topic: "Reentry Programs" },
  { name: "udl", test: /\b(UDL|universal design for learning|lesson plan)\b/i, category: "Teaching & Learning", topic: "Education & UDL" },
  { name: "anthro", test: /\b(anthropolog\w*|ethnograph\w*)\b/i, topic: "Anthropology" },
  { name: "sources", test: /\b(peer[- ]reviewed|source credibility|citations?)\b/i, category: "Research & Analysis", topic: "Research & Evidence" },
];

export function applyRules(text: string): { rule: string; category?: Category; topics: string[] } | null {
  const hits = RULES.filter((r) => r.test.test(text));
  if (hits.length === 0) return null;
  // Exactly one distinct asserted category = unambiguous; conflicting categories leave it to the classifier.
  const cats = new Set(hits.flatMap((h) => (h.category ? [h.category] : [])));
  if (cats.size > 1) return null;
  return { rule: hits[0]!.name, category: [...cats][0], topics: hits.flatMap((h) => (h.topic ? [h.topic] : [])) };
}
