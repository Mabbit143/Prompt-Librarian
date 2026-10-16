import { parse as parseYaml } from "yaml";
import { contentHash } from "../../core/normalize.js";

export type Rule = "frontmatter-type" | "callout-prompt" | "callout-idea" | "fenced-in-prompt-context";
export interface Anchor { heading: string; startLine: number; endLine: number; fingerprint: string }
export interface Extracted {
  rule: Rule; recordType: "Prompt" | "Idea" | "Template"; title: string; content: string; anchor: Anchor; links: string[];
}
export interface ParsedNote {
  frontmatter: Record<string, unknown>; frontmatterError: boolean; title: string; links: string[];
  items: Extracted[]; unqualifiedFences: number;
}

const PLAIN_LANGS = new Set(["", "text", "txt", "markdown", "md", "prompt"]);
const CONTEXT_WORDS = /prompt|template|copy|paste|use this|instruction/i;
const WIKI = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MIN_CHARS = 80, MIN_WORDS = 12, MIN_CALLOUT_CHARS = 40;

// Task/checklist scaffolds ("- [ ] ...") are templates for notes, not prompts.
const isChecklist = (c: string) => /^\s*[-*] \[[ xX]\]/.test(c);
const fp = (s: string) => contentHash(s).slice(0, 16);
const linksIn = (s: string) => [...new Set([...s.matchAll(WIKI)].map((m) => m[1]!.trim()))];

export function splitFrontmatter(raw: string): { fm: Record<string, unknown>; error: boolean; body: string; bodyOffset: number } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: {}, error: false, body: raw, bodyOffset: 0 };
  const lines = m[0].split("\n").length - 1;
  try {
    const v = parseYaml(m[1]!);
    return { fm: v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}, error: false, body: raw.slice(m[0].length), bodyOffset: lines };
  } catch {
    return { fm: {}, error: true, body: raw.slice(m[0].length), bodyOffset: lines };
  }
}

/** Conservative extraction: only structured, clearly-labelled blocks become records. Never modifies anything. */
export function parseNote(raw: string, fileTitle: string): ParsedNote {
  const { fm, error, body, bodyOffset } = splitFrontmatter(raw);
  const lines = body.split(/\r?\n/);
  const items: Extracted[] = [];
  const headings: string[] = [];
  let unqualified = 0;
  const noteType = String(fm.type ?? "").toLowerCase();

  // A note explicitly typed prompt/template/idea is one record (its whole body); no block extraction.
  if (["prompt", "template", "idea"].includes(noteType) && body.trim().length >= MIN_CALLOUT_CHARS) {
    const type = noteType === "idea" ? "Idea" : noteType === "template" ? "Template" : "Prompt";
    const content = body.trim();
    return {
      frontmatter: fm, frontmatterError: error, title: fileTitle, links: linksIn(body), unqualifiedFences: 0,
      items: [{ rule: "frontmatter-type", recordType: type, title: String(fm.title ?? fileTitle), content, links: linksIn(content),
        anchor: { heading: "", startLine: bodyOffset + 1, endLine: bodyOffset + lines.length, fingerprint: fp(content) } }],
    };
  }

  const headingPath = () => headings.filter(Boolean).join(" > ");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { headings.length = h[1]!.length - 1; headings[h[1]!.length - 1] = h[2]!; continue; }

    const fence = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w-]*)/);
    if (fence) {
      const [, , marker, lang] = fence;
      let j = i + 1;
      while (j < lines.length && !new RegExp(`^\\s*${marker![0] === "`" ? "`" : "~"}{${marker!.length},}\\s*$`).test(lines[j]!)) j++;
      const content = lines.slice(i + 1, j).join("\n").trim();
      if (PLAIN_LANGS.has(lang!.toLowerCase()) && content.length >= MIN_CHARS && content.split(/\s+/).length >= MIN_WORDS && !/^[\[{<]/.test(content) && !isChecklist(content)) {
        const prev = lines.slice(Math.max(0, i - 3), i).join(" ");
        if (/prompt/i.test(headingPath()) || CONTEXT_WORDS.test(prev) || lang!.toLowerCase() === "prompt") {
          items.push({ rule: "fenced-in-prompt-context", recordType: /template/i.test(headingPath() + prev) ? "Template" : "Prompt",
            title: headings.filter(Boolean).at(-1) ?? fileTitle, content, links: linksIn(content),
            anchor: { heading: headingPath(), startLine: bodyOffset + i + 1, endLine: bodyOffset + j + 1, fingerprint: fp(content) } });
        } else unqualified++;
      }
      i = j; // skip the block, including non-extracted ones (dataview, tasks, code ...)
      continue;
    }

    const co = line.match(/^>\s*\[!(prompt|idea)\][+-]?\s*(.*)$/i);
    if (co) {
      let j = i + 1;
      const parts: string[] = [];
      while (j < lines.length && /^>/.test(lines[j]!)) { parts.push(lines[j]!.replace(/^>\s?/, "")); j++; }
      const content = parts.join("\n").trim();
      if (content.length >= MIN_CALLOUT_CHARS) {
        const idea = co[1]!.toLowerCase() === "idea";
        items.push({ rule: idea ? "callout-idea" : "callout-prompt", recordType: idea ? "Idea" : "Prompt",
          title: co[2]!.trim() || headings.filter(Boolean).at(-1) || fileTitle, content, links: linksIn(content),
          anchor: { heading: headingPath(), startLine: bodyOffset + i + 1, endLine: bodyOffset + j, fingerprint: fp(content) } });
      }
      i = j - 1;
    }
  }
  return { frontmatter: fm, frontmatterError: error, title: fileTitle, links: linksIn(body), items, unqualifiedFences: unqualified };
}
