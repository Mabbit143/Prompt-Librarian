"use client";
import { useState } from "react";
import { api } from "./lib/client";

export default function QuickCapture() {
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api("/api/records/capture", { method: "POST", body: { content } });
      setMsg(d.status === "duplicate" ? "Already saved; this source was recorded." : d.status === "filed" ? `Filed under ${d.category}.` : `Saved. It needs review (${d.reason}).`);
      setContent("");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not save");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save}>
      <h1>Quick Capture</h1>
      <label htmlFor="c">Paste a prompt or idea</label>
      <textarea id="c" rows={10} value={content} onChange={(e) => setContent(e.target.value)} required />
      <p><button className="primary" disabled={busy}>Save</button></p>
      <p role="status">{msg}</p>
    </form>
  );
}
