"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "../lib/client";

const LINKS = [["/", "Quick Capture"], ["/library", "Library"], ["/review", "Review"], ["/sync", "Sync"]] as const;

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(!!s));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMsg(error ? error.message : "");
  }

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <strong>Prompt Librarian</strong>
        {signedIn && (
          <>
            <nav aria-label="Primary">
              {LINKS.map(([href, label]) => (
                <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}</Link>
              ))}
            </nav>
            <button onClick={() => supabase.auth.signOut()}>Sign out</button>
          </>
        )}
      </header>
      <main id="main">
        {signedIn === null ? <p role="status">Loading…</p> : signedIn ? children : (
          <form onSubmit={signIn} style={{ maxWidth: 340 }}>
            <h1>Sign in</h1>
            <p><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></p>
            <p><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></p>
            <button className="primary">Sign in</button>
            <p role="alert" className="error">{msg}</p>
          </form>
        )}
      </main>
    </>
  );
}
