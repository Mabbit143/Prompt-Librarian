import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { routeRecord } from "../src/notion/route.js";
import { buildPreview, safeCreates, verifyReadBack, type PreviewDeps } from "../src/notion/preview.js";
import { CHUNK, libraryIdFor, mapToPromptLibrary, plain } from "../src/notion/mapping.js";
import type { Destination, ExistsAnswer, NotionIndex, SchemaSnapshot, SyncRecord } from "../src/notion/types.js";

const cfg = JSON.parse(readFileSync("config/notion-destinations.json", "utf8"));
const snap: SchemaSnapshot = JSON.parse(readFileSync("config/notion-snapshots/prompt-engineering-dashboard.json", "utf8"));
const dests = (confirmed: boolean): Destination[] => cfg.destinations.map((d: Destination) => ({ ...d, confirmed }));
const rec = (over: Partial<SyncRecord> = {}): SyncRecord => ({
  id: "11111111-2222-3333-4444-555555555555", title: "Weekly meal planner", content: "Plan a week of healthy dinners.", contentHash: "h1",
  filingStatus: "filed", recordType: "Prompt", category: "Home & Lifestyle", subcategory: null, outputType: "Plan",
  tags: ["podcasts", "not-a-real-tag"], topicTags: [], sources: [{ sourceType: "obsidian", externalId: "obsidian:v:a.md#abc", path: "a.md#L3-L9" }], ...over,
});
const idx = (answer: ExistsAnswer | ((libraryId: string) => ExistsAnswer) = "absent"): NotionIndex => ({
  lookup: (_d, k) => (typeof answer === "function" ? answer(k.libraryId) : answer),
});
const deps = (over: Partial<PreviewDeps> = {}): PreviewDeps => ({
  destinations: dests(true), snapshots: { prompt_library: { ...snap, fetchedAt: new Date().toISOString() } }, index: idx(),
  libraryIdPrefix: cfg.libraryIdPrefix, now: new Date(), ...over,
});

describe("routing", () => {
  it("sends reusable prompts to the prompt library and plain ideas to the ideas inbox", () => {
    expect(routeRecord(rec())).toMatchObject({ kind: "routed", destination: "prompt_library" });
    expect(routeRecord(rec({ recordType: "Template" }))).toMatchObject({ destination: "prompt_library" });
    expect(routeRecord(rec({ recordType: "Idea" }))).toMatchObject({ destination: "ideas_inbox" });
  });
  it("uses only explicit Deconstructing Academia signals", () => {
    expect(routeRecord(rec({ recordType: "Idea", topicTags: ["Deconstructing Academia"] }))).toMatchObject({ destination: "da_idea_bank" });
    expect(routeRecord(rec({ recordType: "Idea", sources: [{ sourceType: "obsidian", path: "RookeryBrain/01_DECONSTRUCTING_ACADEMIA/x.md" }] }))).toMatchObject({ destination: "da_idea_bank" });
    expect(routeRecord(rec({ recordType: "Idea", title: "academia is broken", content: "A DA idea about academia" }))).toMatchObject({ destination: "ideas_inbox" });
  });
  it("stops for a decision when two destinations fit, and skips what must not sync", () => {
    expect(routeRecord(rec({ topicTags: ["Deconstructing Academia"] }))).toMatchObject({ kind: "needs_destination_decision", candidates: ["prompt_library", "da_idea_bank"] });
    expect(routeRecord(rec({ recordType: "Mixed" })).kind).toBe("needs_destination_decision");
    expect(routeRecord(rec({ filingStatus: "needs_review" })).kind).toBe("not_eligible");
    expect(routeRecord(rec({ recordType: "Skill Definition" })).kind).toBe("not_eligible");
  });
});

describe("mapping to the live Prompt Engineering Dashboard schema", () => {
  const id = libraryIdFor(rec().id, "LIBR-");
  it("builds a valid payload and leaves unknown tags out instead of creating options", () => {
    const m = mapToPromptLibrary(rec(), snap, id);
    expect(m.blocked).toBeUndefined();
    expect(plain(m.properties["Prompt Name"])).toBe("Weekly meal planner");
    expect(plain(m.properties["Category"])).toBe("Home & Lifestyle");
    expect(plain(m.properties["Record Type"])).toBe("Prompt");
    expect(plain(m.properties["Library ID"])).toBe("LIBR-1111111122");
    expect(plain(m.properties["Source Locator"])).toBe("a.md#L3-L9");
    expect(plain(m.properties["Use Status"])).toBe("To try");
    expect(plain(m.properties["Tags"])).toBe("podcasts");
    expect(m.warnings.map((w) => w.code)).toEqual(["tags_not_in_options"]);
  });
  it("blocks categories that are not Notion options and record types with no equivalent", () => {
    expect(mapToPromptLibrary(rec({ category: "Anthropology" }), snap, id).blocked).toMatch(/not an option/);
    expect(mapToPromptLibrary(rec({ recordType: "Research Note" }), snap, id).blocked).toMatch(/no matching Record Type/);
  });
  it("stores a Template as a Prompt with Output Type Template", () => {
    const m = mapToPromptLibrary(rec({ recordType: "Template" }), snap, id);
    expect(plain(m.properties["Record Type"])).toBe("Prompt");
    expect(plain(m.properties["Output Type"])).toBe("Template");
  });
  it("splits long prompts across Prompt..Prompt 6 and refuses what cannot fit", () => {
    const m = mapToPromptLibrary(rec({ content: "x".repeat(CHUNK * 2 + 5) }), snap, id);
    expect(["Prompt", "Prompt 2", "Prompt 3"].map((p) => plain(m.properties[p]).length)).toEqual([CHUNK, CHUNK, 5]);
    expect(mapToPromptLibrary(rec({ content: "x".repeat(CHUNK * 6 + 1) }), snap, id).blocked).toMatch(/at most/);
  });
});

describe("preview (read-only)", () => {
  it("proposes a create for a good record and reports every record exactly once", () => {
    const p = buildPreview([rec(), rec({ id: "2", filingStatus: "needs_review" }), rec({ id: "3", recordType: "Mixed" })], deps());
    expect(p.items.map((i) => i.action)).toEqual(["create", "not_eligible", "needs_destination_decision"]);
    expect(p.summary).toMatchObject({ create: 1, not_eligible: 1, needs_destination_decision: 1, blocked: 0, skip_exists: 0 });
    expect(safeCreates(p)[0]).toMatchObject({ libraryId: "LIBR-1111111122", sourceRef: { paths: ["a.md#L3-L9"] } });
  });
  it("never writes to an unconfirmed destination, or with a stale or missing schema", () => {
    expect(buildPreview([rec()], deps({ destinations: dests(false) })).items[0]).toMatchObject({ action: "blocked", reason: expect.stringContaining("not been confirmed") });
    const old = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(buildPreview([rec()], deps({ snapshots: { prompt_library: { ...snap, fetchedAt: old } } })).items[0].reason).toMatch(/stale/);
    expect(buildPreview([rec()], deps({ snapshots: {} })).items[0].reason).toMatch(/no verified schema/);
  });
  it("blocks the DA bank and ideas inbox until their schemas are fetched and mapped", () => {
    const p = buildPreview([rec({ recordType: "Idea" })], deps());
    expect(p.items[0]).toMatchObject({ action: "blocked", destination: "ideas_inbox" });
  });
  it("skips existing copies and blocks when the duplicate check is unsure", () => {
    expect(buildPreview([rec()], deps({ index: idx("exists") })).items[0].action).toBe("skip_exists");
    expect(buildPreview([rec()], deps({ index: idx("unknown") })).items[0].action).toBe("blocked");
  });
  it("is idempotent: after the creates land, a rerun proposes zero creates", () => {
    const records = [rec(), rec({ id: "aaaaaaaa-0000-0000-0000-000000000000", title: "Another", contentHash: "h2" })];
    const first = buildPreview(records, deps());
    expect(first.summary.create).toBe(2);
    const landed = new Set(safeCreates(first).map((i) => i.libraryId!));
    const second = buildPreview(records, deps({ index: idx((lid) => (landed.has(lid) ? "exists" : "absent")) }));
    expect(second.summary).toMatchObject({ create: 0, skip_exists: 2 });
  });
  it("idempotency keys are stable and distinct per record", () => {
    const a = buildPreview([rec()], deps()).items[0]!.idempotencyKey;
    expect(a).toBe(buildPreview([rec()], deps()).items[0]!.idempotencyKey);
    expect(a).not.toBe(buildPreview([rec({ id: "99999999-0000-0000-0000-000000000000" })], deps()).items[0]!.idempotencyKey);
  });
});

describe("read-back verification", () => {
  it("passes when stored values match and reports each mismatch otherwise", () => {
    const item = buildPreview([rec()], deps()).items[0]!;
    expect(verifyReadBack(item, item.properties!)).toEqual([]);
    const tampered = { ...item.properties!, Category: { select: { name: "Finance & Money" } }, Prompt: { rich_text: [{ plain_text: "changed" }] } };
    const bad = verifyReadBack(item, tampered);
    expect(bad).toHaveLength(2);
    expect(bad.join(" ")).toContain("Category");
  });
  it("the committed snapshot matches what the sheet import uses", () => {
    expect(snap.properties["Category"]!.options).toContain("Writing & Editing");
    expect(snap.properties["Output Type"]!.options).toHaveLength(35);
    expect(snap.properties["Record Type"]!.options).toContain("Prompt fragment");
  });
});
