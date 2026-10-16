import type { Route, SyncRecord } from "./types.js";

const PROMPT_LIKE = new Set(["Prompt", "Template", "Workflow", "Prompt bundle", "Prompt fragment", "Reference"]);
const DA = /deconstructing[ _-]?academia/i;

/** Only explicit signals count: a topic tag or a source path naming Deconstructing Academia. Never inferred from wording. */
export const hasDaSignal = (r: SyncRecord) =>
  [...r.tags, ...r.topicTags].some((t) => DA.test(t)) || r.sources.some((s) => DA.test(s.path ?? ""));

/**
 * One destination per record, following the organize-notion-ideas rules:
 * reusable prompt -> prompt library; DA content idea -> DA idea bank; general idea -> ideas inbox.
 * Anything plausible for two destinations stops for a human decision. Content Planning is never an intake destination.
 */
export function routeRecord(r: SyncRecord): Route {
  if (r.filingStatus !== "filed") return { kind: "not_eligible", reason: `status is ${r.filingStatus}; only filed records sync` };
  const t = r.recordType;
  if (t === "Skill Definition") return { kind: "not_eligible", reason: "skills are files, not mirrored into Notion databases" };
  const da = hasDaSignal(r);
  if (t && PROMPT_LIKE.has(t)) {
    return da
      ? { kind: "needs_destination_decision", candidates: ["prompt_library", "da_idea_bank"], reason: "reusable prompt that also carries a Deconstructing Academia signal" }
      : { kind: "routed", destination: "prompt_library", reason: `${t} is a reusable prompt` };
  }
  if (t === "Idea") {
    return da
      ? { kind: "routed", destination: "da_idea_bank", reason: "idea with a Deconstructing Academia signal" }
      : { kind: "routed", destination: "ideas_inbox", reason: "general idea without a Deconstructing Academia signal" };
  }
  return { kind: "needs_destination_decision", candidates: ["prompt_library", "ideas_inbox"], reason: `record type ${t ?? "unknown"} has no fixed destination` };
}
