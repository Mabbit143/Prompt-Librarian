"use client";
import { useCallback, useEffect, useState } from "react";
import { api, qs } from "../lib/client";
import { CATEGORIES } from "../../src/core/taxonomy";
import RecordDetail from "../components/RecordDetail";

const LIMIT = 20;
const STATUSES = [["", "Any status"], ["filed", "Filed"], ["needs_review", "Needs review"], ["inbox", "Inbox"]];
const SOURCES = [["", "Any source"], ["csv", "Spreadsheet import"], ["obsidian", "Obsidian"], ["internal", "Quick Capture"]];

export default function Library() {
  const [f, setF] = useState({ q: "", category: "", status: "", sourceType: "", sort: "newest" });
  const [applied, setApplied] = useState(f);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: any[]; hasMore: boolean } | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const search = applied.q.trim() !== "";
  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const path = search
        ? `/api/search?${qs({ q: applied.q.trim(), category: applied.category, status: applied.status, limit: LIMIT, offset })}`
        : `/api/records?${qs({ category: applied.category, status: applied.status, sourceType: applied.sourceType, sort: applied.sort, limit: LIMIT, offset })}`;
      setData(await api(path));
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); setData(null); }
    finally { setLoading(false); }
  }, [applied, offset, search]);
  useEffect(() => { load(); }, [load]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = (e: React.FormEvent) => { e.preventDefault(); setOffset(0); setApplied(f); };
  const sources = (it: any): { label: string; path?: string }[] =>
    it.sources ? it.sources.map((s: any) => ({ label: s.sourceName ?? s.sourceType, path: s.path })) : it.firstSource ? [{ label: it.firstSource.name }] : [];

  return (
    <>
      <h1>Library</h1>
      <form className="filters" onSubmit={submit} role="search" aria-label="Library search">
        <div className="wide"><label htmlFor="q">Search prompts and ideas</label><input id="q" type="search" value={f.q} onChange={set("q")} placeholder="Words or “an exact phrase”" /></div>
        <div><label htmlFor="cat">Category</label>
          <select id="cat" value={f.category} onChange={set("category")}><option value="">Any category</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label htmlFor="st">Status</label>
          <select id="st" value={f.status} onChange={set("status")}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label htmlFor="src">Source</label>
          <select id="src" value={f.sourceType} onChange={set("sourceType")} disabled={f.q.trim() !== ""} title={f.q.trim() ? "Source filter applies when browsing without a search" : undefined}>
            {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <button className="primary">{f.q.trim() ? "Search" : "Browse"}</button>
      </form>

      <div className="layout">
        <section aria-label="Results" aria-busy={loading}>
          <p role="status" className="snippet">{loading ? "Loading…" : data ? `${data.items.length} ${search ? "matches" : "records"} on this page${data.hasMore ? ", more available" : ""}` : ""}</p>
          {err && <p role="alert" className="error">{err}</p>}
          <ul className="list">
            {data?.items.map((it) => (
              <li key={it.id} className="card" aria-current={openId === it.id}>
                <button className="link" onClick={() => setOpenId(it.id)}>{it.title ?? "(untitled)"}</button>
                <div className="meta">
                  <span className={`badge ${it.filingStatus}`}>{it.filingStatus.replace("_", " ")}</span>
                  {it.category && <span className="badge">{it.category}</span>}
                  {sources(it).slice(0, 2).map((s, i) => <span key={i} title={s.path}>{s.label}{s.path ? ` · ${s.path.split("#")[0]!.split("/").pop()}` : ""}</span>)}
                </div>
                {it.snippet && <p className="snippet">{it.snippet}</p>}
              </li>
            ))}
          </ul>
          {data && data.items.length === 0 && <p>No records match.</p>}
          <div className="pager">
            <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</button>
            <span>Page {offset / LIMIT + 1}</span>
            <button disabled={!data?.hasMore || loading} onClick={() => setOffset(offset + LIMIT)}>Next</button>
          </div>
        </section>
        <section aria-label="Record detail">
          {openId ? <RecordDetail id={openId} onOpen={setOpenId} /> : <p className="snippet">Select a record to see its full text and where it came from.</p>}
        </section>
      </div>
    </>
  );
}
