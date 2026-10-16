import type { Classification } from "./taxonomy.js";

type Rule = { name: string; test: RegExp; category: Classification["primary_category"]; type?: Classification["record_type"] };

// Deterministic, zero-cost filing rules. Extend as approved mappings accumulate.
export const RULES: Rule[] = [
  { name: "funding", test: /\b(scholarship|fellowship|grant)\b/i, category: "Scholarships & Funding" },
  { name: "reentry", test: /\b(reentry|re-entry|formerly incarcerated)\b/i, category: "Reentry Programs" },
  { name: "udl", test: /\b(UDL|universal design for learning|lesson plan)\b/i, category: "Education & UDL" },
  { name: "anthro", test: /\b(anthropolog\w*|ethnograph\w*)\b/i, category: "Anthropology" },
  { name: "sources", test: /\b(peer[- ]reviewed|source credibility|citations?)\b/i, category: "Research & Evidence" },
];

export function applyRules(text: string): { rule: string; category: Rule["category"] } | null {
  const hits = RULES.filter((r) => r.test.test(text));
  // Exactly one distinct category = unambiguous; otherwise leave it to the classifier.
  const cats = new Set(hits.map((h) => h.category));
  return cats.size === 1 ? { rule: hits[0]!.name, category: hits[0]!.category } : null;
}
