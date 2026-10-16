"use client";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMsg(error ? error.message : "");
    setSignedIn(!error);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/records/capture", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }),
    });
    const json = await res.json();
    if (!json.success) return setMsg(json.error.message);
    const d = json.data;
    setMsg(d.status === "duplicate" ? "Already saved; source recorded." : d.status === "filed" ? `Filed under ${d.category}.` : `Saved. Needs review (${d.reason}).`);
    setContent("");
  }

  if (!signedIn)
    return (
      <form onSubmit={signIn}>
        <h1>Prompt Librarian</h1>
        <p><label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label></p>
        <p><label>Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label></p>
        <button>Sign in</button> <span role="status">{msg}</span>
      </form>
    );

  return (
    <form onSubmit={save}>
      <h1>Quick Capture</h1>
      <label htmlFor="c">Paste a prompt or idea</label>
      <textarea id="c" rows={10} style={{ width: "100%" }} value={content} onChange={(e) => setContent(e.target.value)} required />
      <button>Save</button> <span role="status">{msg}</span>
    </form>
  );
}
