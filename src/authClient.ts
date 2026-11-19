export type Operator = { id: string; email?: string };
type Config = { supabaseUrl: string; publicKey: string; api: string };
type Tokens = { access_token: string; refresh_token: string; expires_in?: number };
const refreshKey = "opencollector.refresh";
const loginKey = "opencollector.pkce";
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

export class DashboardSession {
  private access = "";
  private expires = 0;
  private generation = 0;
  private refreshing: Promise<string> | undefined;
  private config: Config;
  private storage: Storage;
  private request: typeof fetch;
  constructor(config: Config, storage: Storage, request: typeof fetch = fetch) {
    for (const value of [config.supabaseUrl, config.api]) {
      const url = new URL(value);
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
        throw new Error("Dashboard services must use HTTPS or local loopback HTTP.");
      }
    }
    this.config = { ...config, api: new URL(config.api).origin, supabaseUrl: new URL(config.supabaseUrl).origin };
    this.storage = storage;
    this.request = request.bind(globalThis);
  }
  async loginUrl(origin: string): Promise<string> {
    this.forget();
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const path = `/auth/callback/${base64url(crypto.getRandomValues(new Uint8Array(24)))}`;
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    this.storage.setItem(loginKey, JSON.stringify({ verifier, path, createdAt: Date.now() }));
    const url = new URL(`${this.config.supabaseUrl}/auth/v1/authorize`);
    url.search = new URLSearchParams({ provider: "google", redirect_to: `${origin}${path}`, code_challenge: challenge, code_challenge_method: "s256", prompt: "select_account" }).toString();
    return url.href;
  }
  async restore(url: URL): Promise<boolean> {
    if (url.pathname.startsWith("/auth/callback/")) {
      const raw = this.storage.getItem(loginKey);
      this.storage.removeItem(loginKey);
      const pending = raw ? JSON.parse(raw) as { path: string; verifier: string; createdAt: number } : undefined;
      if (!pending || pending.path !== url.pathname || Date.now() - pending.createdAt > 600_000 || url.searchParams.has("error") || url.searchParams.getAll("code").length !== 1 || !url.searchParams.get("code")) {
        throw new Error("Google sign-in did not complete. Please try again in this tab.");
      }
      await this.issue("pkce", { auth_code: url.searchParams.get("code"), code_verifier: pending.verifier });
      return true;
    }
    if (!this.storage.getItem(refreshKey)) return false;
    await this.token();
    return true;
  }
  async token(): Promise<string> {
    if (this.access && Date.now() < this.expires) return this.access;
    if (this.refreshing) return this.refreshing;
    const refresh = this.storage.getItem(refreshKey);
    if (!refresh) throw new Error("Please sign in with Google.");
    this.refreshing = this.issue("refresh_token", { refresh_token: refresh }).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  private async issue(grant: string, body: object): Promise<string> {
    const generation = this.generation;
    const data = await this.supabase(`/token?grant_type=${grant}`, body) as Tokens;
    if (generation !== this.generation) throw new Error("Sign-in was cancelled.");
    if (!data || typeof data.access_token !== "string" || typeof data.refresh_token !== "string") throw new Error("Invalid sign-in response. Please try again.");
    this.storage.setItem(refreshKey, data.refresh_token);
    this.access = data.access_token;
    this.expires = Date.now() + Math.max(0, (data.expires_in ?? 60) - 30) * 1000;
    return this.access;
  }
  private async supabase(path: string, body?: object, access?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(`${this.config.supabaseUrl}/auth/v1${path}`, {
        method: "POST", headers: { apikey: this.config.publicKey, "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000), credentials: "omit", redirect: "error",
      });
    } catch { throw new Error("Could not reach sign-in. Check your connection and retry."); }
    if (!response.ok) {
      if ([400, 401, 403].includes(response.status)) this.forget();
      throw new Error("Your sign-in could not be verified. Please sign in again.");
    }
    return response.status === 204 ? null : response.json();
  }
  async fetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input);
    if (url.origin !== this.config.api || !url.pathname.startsWith("/v1/")) throw new Error("Refusing to send a session to another service.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await this.token()}`);
    const response = await this.request(url, { ...init, headers, redirect: "error", credentials: "omit", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      this.forget();
      throw new Error(response.status === 403 ? "This account does not have dashboard access." : "Your session expired. Please sign in again.");
    }
    return response;
  }
  async operator(): Promise<Operator> {
    const response = await this.fetch(`${this.config.api}/v1/auth/me`);
    if (!response.ok) throw new Error("Could not check dashboard access. Please retry.");
    return response.json() as Promise<Operator>;
  }
  forget(): void {
    this.generation++;
    this.access = ""; this.expires = 0; this.refreshing = undefined;
    this.storage.removeItem(refreshKey);
  }
  async logout(): Promise<void> {
    const access = this.access;
    this.forget();
    this.storage.removeItem(loginKey);
    if (access) await this.supabase("/logout?scope=local", undefined, access);
  }
}
