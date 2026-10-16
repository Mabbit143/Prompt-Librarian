"use client";
import { useCallback, useEffect, useState } from "react";
import { api, qs } from "../lib/client";

const LIMIT = 50;
const LABEL: Record<string, string> = {
  create: "Would create", skip_exists: "Already in Notion", blocked: "Blocked", needs_destination_decision: "Needs a destination decision", not_eligible: "Not eligible",
};
const ORDER = ["create", "blocked", "needs_destination_decision", "skip_exists", "not_eligible"];
const plain = (v: any): string => (v?.title ?? v?.rich_text)?.map((t: any) => t.text?.content ?? "").join("") ?? v?.select?.name ?? "";

export default function Sync() {
  const [explore, setExplore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<any>(null);
  const [filter, setFilter] = useState<string>("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [dry, setDry] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr(""); setDry("");
    try { setData(await api(`/api/sync/preview?${qs({ limit: LIMIT, offset, explore: explore ? 1 : 0 })}`)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
    finally { setLoading(false); }
  }, [offset, explore]);
  useEffect(() => { load(); }, [load]);

  async function runDry() {
    setDry("Running dry run…");
    try {
      const d = await api("/api/sync/dry-run", { method: "POST", body: { limit: LIMIT, offset, explore } });
      setDry(`Dry run finished: ${d.result.wouldCreate} page${d.result.wouldCreate === 1 ? "" : "s"} would be created. Nothing was sent to Notion.`);
    } catch (e) { setDry(e instanceof Error ? e.message : "Dry run failed"); }
  }

  const items: any[] = data?.preview.items ?? [];
  const shown = filter ? items.filter((i) => i.action === filter) : items;
  const summary: Record<string, number> = data?.preview.summary ?? {};

  return (
    <>
      <h1>Notion sync preview</h1>
      <p className="notice">Preview only. Nothing is sent to Notion, and there is no way to write from here: no Notion connection is set up for writing.</p>

      {data && (
        <section aria-label="Destination" className="card">
          <dl className="kv">
            <dt>Destination</dt><dd>{data.destination.name} ({data.destination.rowCount.toLocaleString()} rows), {data.destination.confirmed ? "confirmed by you" : "not confirmed"}</dd>
            <dt>Schema snapshot</dt><dd>{data.schema.properties} properties, captured {data.schema.ageMinutes < 120 ? `${data.schema.ageMinutes} minutes` : `${Math.round(data.schema.ageMinutes / 60)} hours`} ago</dd>
            <dt>Mode</dt><dd>{data.mode === "explore" ? "Explore: assumes Notion has no copy and ignores schema age. For looking only." : "Strict: reports the real blockers."}</dd>
            <dt>Digest</dt><dd><code aria-label="Preview digest">{data.digest.slice(0, 16)}…</code> ({data.approvableReason})</dd>
          </dl>
        </section>
      )}

      <div className="actions" style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={explore} onChange={(e) => { setExplore(e.target.checked); setOffset(0); }} />
          Explore what the mapping would create
        </label>
        <button onClick={load} disabled={loading}>Refresh</button>
        <button className="primary" onClick={runDry} disabled={loading || !data}>Run dry run</button>
      </div>
      <p role="status">{dry}</p>
      {err && <p role="alert" className="error">{err}</p>}

      <div className="tabs" role="group" aria-label="Filter by outcome">
        <button aria-pressed={filter === ""} onClick={() => setFilter("")}>All ({items.length})</button>
        {ORDER.filter((a) => summary[a]).map((a) => <button key={a} aria-pressed={filter === a} onClick={() => setFilter(a)}>{LABEL[a]} ({summary[a]})</button>)}
      </div>

      {loading && !data ? <p role="status">Loading…</p> : (
        <ul className="list" aria-busy={loading}>
          {shown.map((i) => (
            <li key={i.recordId} className="card">
              <strong>{i.title}</strong>
              <div className="meta"><span className={`badge ${i.action === "create" ? "filed" : i.action === "blocked" ? "needs_review" : ""}`}>{LABEL[i.action]}</span>{i.libraryId && <span>{i.libraryId}</span>}</div>
              <p className="snippet">{i.reason}</p>
              {i.action === "create" && i.properties && (
                <dl className="kv">
                  <dt>Category</dt><dd>{plain(i.properties.Category)}</dd>
                  <dt>Record type</dt><dd>{plain(i.properties["Record Type"])}</dd>
                  {i.properties["Output Type"] && <><dt>Output type</dt><dd>{plain(i.properties["Output Type"])}</dd></>}
                  <dt>Source</dt><dd>{plain(i.properties["Source Locator"]) || "none recorded"}</dd>
                </dl>
              )}
              {i.warnings.map((w: any) => <p key={w.code} className="snippet">Note: {w.message}</p>)}
            </li>
          ))}
        </ul>
      )}
      {data && items.length === 0 && <p>No filed records on this page.</p>}
      <div className="pager">
        <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</button>
        <span>Records {offset + 1} to {offset + (data?.loaded ?? 0)}, newest first</span>
        <button disabled={(data?.loaded ?? 0) < LIMIT || loading} onClick={() => setOffset(offset + LIMIT)}>Next</button>
      </div>
    </>
  );
}
