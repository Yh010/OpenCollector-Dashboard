import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DashboardSession, type Operator } from "./authClient";
import "./auth.css";

const session = new DashboardSession({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "https://hzrnpjibpbaxjmlbfkeh.supabase.co",
  publicKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_Oz_JF1jdKuCkoox5LnffJw_qBTy6NC8",
  api: import.meta.env.VITE_OPENCOLLECTOR_URL ?? "http://127.0.0.1:3000",
}, sessionStorage);
const Account = createContext<{ user: Operator; logout: () => void } | null>(null);

export async function authenticatedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  try { return await session.fetch(input, init); }
  catch (error) {
    if (!sessionStorage.getItem("opencollector.refresh")) window.dispatchEvent(new CustomEvent("collector-signed-out", { detail: error instanceof Error ? error.message : "Please sign in again." }));
    throw error;
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Operator>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const url = new URL(location.href);
    // Remove one-time codes from browser history before any telemetry requests.
    if (url.pathname.startsWith("/auth/callback/")) history.replaceState(null, "", "/");
    session.restore(url).then(async present => present ? session.operator() : undefined)
      .then(account => { if (active) setUser(account); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Could not sign in. Please retry."); })
      .finally(() => { if (active) setBusy(false); });
    const expired = (event: Event) => { setUser(undefined); setError((event as CustomEvent<string>).detail); setBusy(false); };
    window.addEventListener("collector-signed-out", expired);
    return () => { active = false; window.removeEventListener("collector-signed-out", expired); };
  }, [retry]);
  const login = async () => {
    setBusy(true); setError("");
    try { location.assign(await session.loginUrl(location.origin)); }
    catch { setError("Could not open Google sign-in. Please try again."); setBusy(false); }
  };
  const logout = () => {
    setUser(undefined); setBusy(true); setError("");
    void session.logout().catch(() => setError("Signed out in this tab. The server could not be reached to revoke the session."))
      .finally(() => setBusy(false));
  };
  if (user) return <Account.Provider value={{ user, logout }}>{children}</Account.Provider>;
  return <main className="auth-page">
    <a className="brand auth-brand" href="/" aria-label="OpenCollector home"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m3 8 9-5 9 5-9 5-9-5Zm0 4 9 5 9-5M3 16l9 5 9-5"/></svg></span><span>OpenCollector<small>Telemetry workspace</small></span></a>
    <section className="auth-content" aria-labelledby="sign-in-title">
      <h1 id="sign-in-title">Sign in to OpenCollector</h1>
      <p>Use your approved Google account to open the telemetry workspace.</p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="auth-actions">
        <button type="button" disabled={busy} onClick={() => void login()}>{busy ? "Checking your account…" : "Continue with Google"}</button>
        {error && <button type="button" className="text-button" disabled={busy} onClick={() => { setBusy(true); setError(""); setRetry(value => value + 1); }}>Retry connection</button>}
      </div>
      <p className="auth-note">Dashboard access is limited to approved accounts. Signing in to OpenKode does not grant dashboard access.</p>
    </section>
  </main>;
}

export function AccountMenu() {
  const account = useContext(Account);
  if (!account) return null;
  return <span className="auth-account"><span className="auth-email" title={account.user.email ?? account.user.id}>{account.user.email ?? "Signed in"}</span><button type="button" className="secondary" onClick={account.logout}>Sign out</button></span>;
}
