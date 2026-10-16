"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/client";

const isUrl = (s?: string | null) => !!s && /^https?:\/\//.test(s);
const STATUS: Record<string, string> = { filed: "Filed", needs_review: "Needs review", inbox: "Inbox" };

export default function RecordDetail({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  const [rec, setRec] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    setRec(null); setErr("");
    api(`/api/records/${id}`).then((d) => live && setRec(d)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [id]);

  if (err) return <p role="alert" className="error">{err}</p>;
  if (!rec) return <p role="status">Loading record…</p>;
  return (
    <article className="card" aria-labelledby="rec-title">
      <h2 id="rec-title">{rec.title}</h2>
      <div className="meta">
        <span className={`badge ${rec.filingStatus}`}>{STATUS[rec.filingStatus] ?? rec.filingStatus}</span>
        {rec.category && <span className="badge">{rec.category}</span>}
        {rec.recordType && <span className="badge">{rec.recordType}</span>}
      </div>
      {rec.reviewReason && <p className="notice">Needs review: {rec.reviewReason}</p>}

      <h3>Original text</h3>
      <pre className="orig" tabIndex={0} aria-label="Original text">{rec.originalContent}</pre>

      <h3>Where it came from</h3>
      <ul className="list">
        {rec.occurrences.map((o: any, i: number) => (
          <li key={i}>
            <strong>{o.sourceName ?? o.sourceType ?? "Unknown source"}</strong>{" "}
            {isUrl(o.url) ? <a href={o.url}>{o.url}</a> : null}
            <div className="snippet">{o.path ?? "Location not recorded"}</div>
          </li>
        ))}
        {rec.occurrences.length === 0 && <li className="snippet">No source location recorded.</li>}
      </ul>

      {rec.classification && (
        <>
          <h3>Classification</h3>
          <dl className="kv">
            <dt>Confidence</dt><dd>{Math.round(rec.classification.confidence * 100)}% ({rec.classification.confidence_reason})</dd>
            <dt>Tags</dt><dd>{[...rec.classification.tags, ...rec.classification.topic_tags].join(", ") || "none"}</dd>
            <dt>Version</dt><dd>{rec.classificationVersion}</dd>
          </dl>
        </>
      )}

      {rec.relationships.length > 0 && (
        <>
          <h3>Related records</h3>
          <ul className="list">
            {rec.relationships.map((r: any) => (
              <li key={r.otherId}>
                {onOpen ? <button className="link" onClick={() => onOpen(r.otherId)}>{r.otherTitle ?? r.otherId}</button> : r.otherTitle}
                <span className="snippet"> {r.type.replace("_", " ")}{r.score ? `, ${Math.round(r.score * 100)}% similar` : ""} ({r.reviewStatus})</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="snippet">Added {new Date(rec.createdAt).toLocaleString()}</p>
    </article>
  );
}
