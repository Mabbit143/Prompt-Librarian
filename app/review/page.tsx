"use client";
import { useCallback, useEffect, useState } from "react";
import { api, qs } from "../lib/client";
import { CATEGORIES } from "../../src/core/taxonomy";

const TYPE_LABEL: Record<string, string> = {
  uncertain_classification: "Uncertain classification", potential_duplicate: "Potential duplicates", title_suggestion: "Title suggestions",
  category_change: "Category changes", conflicting_metadata: "Conflicting metadata", failed_sync: "Failed sync", new_category: "New categories",
};
const RELATIONS: [string, string][] = [["near_duplicate", "Confirm near-duplicate"], ["revision_of", "Mark as revision"], ["related", "Mark as related"]];

function Card({ item, onDone }: { item: any; onDone: (id: string, what: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<string>(item.proposed?.category ?? "");
  const [title, setTitle] = useState<string>(item.proposed?.title ?? "");
  const [other, setOther] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const dup = item.type === "potential_duplicate";

  async function decide(body: object, what: string) {
    setBusy(true); setErr("");
    try { await api(`/api/reviews/${item.id}/decision`, { method: "POST", body }); onDone(item.id, what); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save"); setBusy(false); }
  }
  async function loadOther() {
    try { setOther(await api(`/api/records/${item.proposed.record_b_id}`)); } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }

  return (
    <li className="card">
      <h3 style={{ margin: 0 }}>{String(item.record?.snippet ?? "(record unavailable)").split("\n")[0].slice(0, 90)}</h3>
      <div className="meta">
        <span className="badge needs_review">{item.reason}</span>
        {item.confidence != null && <span>{Math.round(item.confidence * 100)}% {dup ? "similar" : "confident"}</span>}
        {item.record?.category && <span className="badge">Currently: {item.record.category}</span>}
      </div>
      
      {item.type === "new_category" && item.proposed?.proposed_category && !editing && <p>The classifier found no fitting category and proposes <strong>{item.proposed.proposed_category}</strong>. Closest existing: <strong>{item.proposed.category}</strong>.</p>}
      {!dup && item.type !== "new_category" && item.proposed?.category && !editing && <p>Suggested: <strong>{item.proposed.category}</strong>{item.proposed.title ? <> titled “{item.proposed.title}”</> : null}</p>}
      {!dup && item.proposed?.rule_category && item.proposed.rule_category !== item.proposed.category && !editing && <p>A filing rule points to <strong>{item.proposed.rule_category}</strong> instead.</p>}
      {!dup && !item.proposed && !editing && <p className="snippet">The classifier gave no suggestion. Choose a category to file it.</p>}

      {dup && (
        <div>
          {!other ? <button onClick={loadOther}>Compare with the similar record</button> : (
            <div className="card" aria-label="Similar record"><strong>{other.title}</strong>
              <pre className="orig">{other.originalContent.slice(0, 600)}</pre></div>)}
        </div>
      )}

      {editing && !dup && (
        <div className="row">
          <div><label htmlFor={`c${item.id}`}>Category</label>
            <select id={`c${item.id}`} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Choose…</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label htmlFor={`t${item.id}`}>Title (optional)</label><input id={`t${item.id}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} /></div>
        </div>
      )}

      <div className="actions">
        {dup ? (
          <>
            {RELATIONS.map(([type, label]) => (
              <button key={type} disabled={busy} className={type === "near_duplicate" ? "primary" : undefined}
                onClick={() => decide(type === "near_duplicate" ? { decision: "approve" } : { decision: "edit", change: { relationship_type: type } }, label)}>{label}</button>
            ))}
            <button disabled={busy} onClick={() => decide({ decision: "reject" }, "Kept separate")}>Keep separate</button>
          </>
        ) : editing ? (
          <>
            <button className="primary" disabled={busy || !category} onClick={() => decide({ decision: "edit", change: { category, ...(title.trim() ? { title: title.trim() } : {}) } }, `Filed under ${category}`)}>File under this category</button>
            <button disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            {item.type === "new_category" && item.proposed?.proposed_category && <button className="primary" disabled={busy} onClick={() => decide({ decision: "approve" }, `Created “${item.proposed.proposed_category}” and filed it there`)}>Create “{item.proposed.proposed_category}” and file here</button>}
            {item.type === "new_category" && item.proposed?.category && <button disabled={busy} onClick={() => decide({ decision: "edit", change: { category: item.proposed.category } }, `Filed under ${item.proposed.category}`)}>Use {item.proposed.category} instead</button>}
            {item.type !== "new_category" && item.proposed?.category && <button className="primary" disabled={busy} onClick={() => decide({ decision: "approve" }, `Filed under ${item.proposed.category}`)}>File under {item.proposed.category}</button>}
            {item.proposed?.rule_category && item.proposed.rule_category !== item.proposed.category && <button disabled={busy} onClick={() => decide({ decision: "edit", change: { category: item.proposed.rule_category } }, `Filed under ${item.proposed.rule_category}`)}>File under {item.proposed.rule_category}</button>}
            <button disabled={busy} onClick={() => setEditing(true)}>{item.proposed?.category ? "Choose a different category" : "Choose a category"}</button>
            <button disabled={busy} onClick={() => decide({ decision: "reject" }, "Left in review")}>Not now</button>
          </>
        )}
      </div>
      {err && <p role="alert" className="error">{err}</p>}
    </li>
  );
}

export default function Review() {
  const [type, setType] = useState("");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [said, setSaid] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { setData(await api(`/api/reviews?${qs({ status: "pending", type, limit: 50 })}`)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
    finally { setLoading(false); }
  }, [type]);
  useEffect(() => { load(); }, [load]);

  const pending: Record<string, number> = data?.pending ?? {};
  const total = Object.values(pending).reduce((a, b) => a + b, 0);
  const done = (id: string, what: string) => { setSaid(`${what}.`); load(); void id; };

  return (
    <>
      <h1>Review queue</h1>
      <p className="notice">Decisions here only change the Librarian’s own metadata. Nothing is written back to Notion, Google Sheets, or Obsidian, and records are never merged.</p>
      <div className="tabs" role="group" aria-label="Queue type">
        <button aria-pressed={type === ""} onClick={() => setType("")}>All ({total})</button>
        {Object.keys(pending).map((t) => <button key={t} aria-pressed={type === t} onClick={() => setType(t)}>{TYPE_LABEL[t] ?? t} ({pending[t]})</button>)}
      </div>
      <p role="status" className="snippet">{said}</p>
      {err && <p role="alert" className="error">{err}</p>}
      {loading && !data ? <p role="status">Loading…</p> : (
        <ul className="list" aria-busy={loading}>
          {data?.items.map((it: any) => <Card key={it.id} item={it} onDone={done} />)}
        </ul>
      )}
      {data && data.items.length === 0 && <p>Nothing waiting for review.</p>}
      {data?.hasMore && <p className="snippet">Showing the first 50. Decide some to see more.</p>}
    </>
  );
}
