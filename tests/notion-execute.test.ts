// The executor is only ever exercised against FakeNotion below. No real Notion call is made anywhere in this file.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildPreview, type Preview } from "../src/notion/preview.js";
import { executeBatch, previewDigest, rerunCheck, createRateLimiter, MemoryWriteLedger, HARD_MAX_BATCH, type ExecDeps, type NotionWriter } from "../src/notion/execute.js";
import { plain } from "../src/notion/mapping.js";
import type { Destination, ExistsAnswer, NotionIndex, SchemaSnapshot, SyncRecord } from "../src/notion/types.js";

const cfg = JSON.parse(readFileSync("config/notion-destinations.json", "utf8"));
const snap: SchemaSnapshot = JSON.parse(readFileSync("config/notion-snapshots/prompt-engineering-dashboard.json", "utf8"));
const dests: Destination[] = cfg.destinations;

class FakeNotion implements NotionWriter, NotionIndex {
  pages = new Map<string, Record<string, unknown>>();
  createCalls: number[] = []; fetchCalls = 0;
  failOnCall = 0; throwAfterCreateOnCall = 0; corruptCategory = false; unsure = false;
  constructor(private clock: () => number) {}
  async createPage(ds: string, properties: Record<string, unknown>) {
    expect(ds).toBe("4b40e2ad-27a1-8332-a2a8-07b66128a21c");
    this.createCalls.push(this.clock());
    const n = this.createCalls.length;
    if (n === this.failOnCall) throw new Error("Notion 500");
    const id = `page-${this.pages.size + 1}`;
    this.pages.set(id, this.corruptCategory ? { ...properties, Category: { select: { name: "Finance & Money" } } } : properties);
    if (n === this.throwAfterCreateOnCall) throw new Error("timeout after create");
    return { pageId: id };
  }
  async fetchPage(id: string) { this.fetchCalls++; return { properties: this.pages.get(id)! }; }
  lookup(_d: string, k: { libraryId: string }): ExistsAnswer {
    if (this.unsure) return "unknown";
    return [...this.pages.values()].some((p) => plain(p["Library ID"]) === k.libraryId) ? "exists" : "absent";
  }
}

const rec = (n: number, over: Partial<SyncRecord> = {}): SyncRecord => ({
  id: `0000000${n}-aaaa-bbbb-cccc-dddddddddddd`, title: `Prompt ${n}`, content: `Write prompt number ${n} about dinners.`, contentHash: `h${n}`,
  filingStatus: "filed", recordType: "Prompt", category: "Home & Lifestyle", subcategory: null, outputType: "Plan", tags: [],
  topicTags: [], sources: [{ sourceType: "obsidian", externalId: `ext${n}`, path: `n${n}.md#L1-L4` }], ...over,
});

function setup(count = 3) {
  let t = Date.now();
  const clock = () => t;
  const sleeps: number[] = [];
  const notion = new FakeNotion(clock);
  const records = Array.from({ length: count }, (_, i) => rec(i + 1));
  const preview = () => buildPreview(records, { destinations: dests.map((d) => ({ ...d, confirmed: d.key === "prompt_library" })), snapshots: { prompt_library: { ...snap, fetchedAt: new Date(t).toISOString() } }, index: notion, libraryIdPrefix: "LIBR-", now: new Date(t) });
  const p = preview();
  const deps = (over: Partial<ExecDeps> = {}): ExecDeps => ({
    writer: notion, index: notion, ledger: new MemoryWriteLedger(), destinations: dests.map((d) => ({ ...d, confirmed: d.key === "prompt_library" })),
    now: clock, sleep: async (ms) => { sleeps.push(ms); t += ms; }, writesEnabled: true, dryRun: false,
    approval: { digest: previewDigest(p), approvedBy: "user", approvedAt: new Date(t).toISOString() }, ...over,
  });
  return { notion, records, p, preview, deps, sleeps, advance: (ms: number) => { t += ms; } };
}

describe("gates (nothing reaches Notion unless every gate passes)", () => {
  it("is a dry run by default and never calls the writer", async () => {
    const s = setup();
    const r = await executeBatch(s.p, { ...s.deps(), dryRun: undefined });
    expect(r).toMatchObject({ mode: "dry_run", wouldCreate: 3 });
    expect(s.notion.createCalls).toHaveLength(0);
    expect(s.notion.pages.size).toBe(0);
  });
  it("refuses when the kill switch is off, even with dryRun false and a valid approval", async () => {
    const s = setup();
    expect(await executeBatch(s.p, s.deps({ writesEnabled: false }))).toMatchObject({ mode: "refused", refusal: expect.stringContaining("disabled") });
    expect(s.notion.createCalls).toHaveLength(0);
  });
  it("refuses without approval or with an approval for a different preview", async () => {
    const s = setup();
    expect((await executeBatch(s.p, s.deps({ approval: undefined }))).refusal).toMatch(/no approval/);
    const changed: Preview = JSON.parse(JSON.stringify(s.p));
    changed.items[0]!.properties!["Category"] = { select: { name: "Finance & Money" } };
    expect((await executeBatch(changed, s.deps())).refusal).toMatch(/does not match/);
    expect(s.notion.createCalls).toHaveLength(0);
  });
  it("refuses oversized batches, stale previews and unconfirmed destinations", async () => {
    const big = setup(4);
    expect((await executeBatch(big.p, big.deps({ maxBatch: 3 }))).refusal).toMatch(/exceeds the limit of 3/);
    const huge = setup(HARD_MAX_BATCH + 1);
    expect((await executeBatch(huge.p, huge.deps({ maxBatch: 1000 }))).refusal).toMatch(/limit of 50/);
    const old = setup();
    old.advance(20 * 60 * 1000);
    expect((await executeBatch(old.p, old.deps())).refusal).toMatch(/too old/);
    const un = setup();
    expect((await executeBatch(un.p, un.deps({ destinations: dests.map((d) => ({ ...d, confirmed: false })) }))).refusal).toMatch(/not confirmed/);
    for (const s of [big, huge, old, un]) expect(s.notion.createCalls).toHaveLength(0);
  });
});

describe("live batch (fake Notion)", () => {
  it("creates, reads back and verifies each page, spaced by the rate limit", async () => {
    const s = setup();
    const r = await executeBatch(s.p, s.deps());
    expect(r.items.map((i) => i.status)).toEqual(["created_verified", "created_verified", "created_verified"]);
    expect(r.stoppedEarly).toBe(false);
    expect(s.notion.pages.size).toBe(3);
    expect(s.notion.fetchCalls).toBe(3);
    const gaps = s.notion.createCalls.slice(1).map((c, i) => c - s.notion.createCalls[i]!);
    expect(gaps.every((g) => g >= 350)).toBe(true);
  });

  it("rerun check: a fresh preview proposes no creates, and replaying the old one writes nothing", async () => {
    const s = setup();
    const ledger = new MemoryWriteLedger();
    const r = await executeBatch(s.p, s.deps({ ledger }));
    const rerun = s.preview();
    expect(rerun.summary).toMatchObject({ create: 0, skip_exists: 3 });
    expect(rerunCheck(r, rerun)).toEqual({ clean: true, offenders: [] });
    const replay = await executeBatch(s.p, s.deps({ ledger }));
    expect(replay.items.map((i) => i.status)).toEqual(["already_written", "already_written", "already_written"]);
    expect(s.notion.pages.size).toBe(3);
    // rerunCheck flags a rerun that would still create something already written
    expect(rerunCheck(r, s.p).clean).toBe(false);
  });

  it("stops at the first failed create, leaves the rest untouched, and does not retry blindly", async () => {
    const s = setup();
    s.notion.failOnCall = 2;
    const r = await executeBatch(s.p, s.deps());
    expect(r.items.map((i) => i.status)).toEqual(["created_verified", "failed", "not_attempted"]);
    expect(r.stoppedEarly).toBe(true);
    expect(s.notion.createCalls).toHaveLength(2);
    expect(s.notion.pages.size).toBe(1);
  });

  it("a create that errors after succeeding is not duplicated on the next run", async () => {
    const s = setup(1);
    s.notion.throwAfterCreateOnCall = 1;
    const r1 = await executeBatch(s.p, s.deps());
    expect(r1.items[0]!.status).toBe("failed");
    expect(s.notion.pages.size).toBe(1); // it did land
    const p2 = s.preview();
    expect(p2.summary).toMatchObject({ create: 0, skip_exists: 1 });
    const r2 = await executeBatch(p2, s.deps({ approval: { digest: previewDigest(p2), approvedBy: "user", approvedAt: "t" } }));
    expect(r2.wouldCreate).toBe(0);
    expect(s.notion.pages.size).toBe(1);
  });

  it("a page appearing between preview and write is skipped, not duplicated", async () => {
    const s = setup(1);
    await s.notion.createPage("4b40e2ad-27a1-8332-a2a8-07b66128a21c", s.p.items[0]!.properties!); // someone else created it
    s.notion.createCalls.length = 0;
    const r = await executeBatch(s.p, s.deps());
    expect(r.items[0]!.status).toBe("skipped_exists");
    expect(s.notion.createCalls).toHaveLength(0);
  });

  it("stops when read-back finds a different stored value", async () => {
    const s = setup();
    s.notion.corruptCategory = true;
    const r = await executeBatch(s.p, s.deps());
    expect(r.items[0]).toMatchObject({ status: "failed" });
    expect(r.items[0]!.errors.join(" ")).toContain("Category");
    expect(r.items.slice(1).every((i) => i.status === "not_attempted")).toBe(true);
  });

  it("does not write when the existence check is unsure", async () => {
    const s = setup(2);
    const p = s.p;
    s.notion.unsure = true;
    const r = await executeBatch(p, s.deps());
    expect(r.items.map((i) => i.status)).toEqual(["failed", "not_attempted"]);
    expect(s.notion.createCalls).toHaveLength(0);
  });
});

describe("rate limiter", () => {
  it("waits only as long as needed between calls", async () => {
    let t = 1000;
    const slept: number[] = [];
    const wait = createRateLimiter(350, () => t, async (ms) => { slept.push(ms); t += ms; });
    await wait(); t += 100; await wait(); t += 500; await wait();
    expect(slept).toEqual([250]);
  });
});
