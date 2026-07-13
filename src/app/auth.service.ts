import { Injectable, signal } from '@angular/core';

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
}

interface StoredTokens {
  id_token: string;
  access_token?: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

const w = globalThis as unknown as {
  __KUBESWIFT_OIDC_ISSUER__?: string;
  __KUBESWIFT_OIDC_CLIENT_ID__?: string;
};
const ISSUER = (w.__KUBESWIFT_OIDC_ISSUER__ ?? '').replace(/\/$/, '');
const CLIENT_ID = w.__KUBESWIFT_OIDC_CLIENT_ID__ ?? '';
const STORE = 'kubeswift.oidc.tokens';

/**
 * AuthService runs a browser OIDC Authorization-Code + PKCE login against the
 * configured IdP (Keycloak) and exposes the resulting ID token so the gateway
 * can impersonate the user (decisions A1/B). When no OIDC config is injected
 * (window.__KUBESWIFT_OIDC_*), auth is OFF and the UI talks to the gateway with
 * no token — the insecure/dev mode, unchanged.
 *
 * It is intentionally hand-rolled on the browser-native crypto + fetch (no auth
 * library): the surface is small (discover → redirect → code exchange → refresh)
 * and a security-critical flow is clearer with every step visible.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** OIDC is configured -> login required. */
  readonly enabled = !!(ISSUER && CLIENT_ID);
  /** The signed-in username (email/preferred_username), reactive for the shell. */
  readonly user = signal<string | null>(null);
  /** A human-readable sign-in error for the login screen. Null = none. */
  readonly error = signal<string | null>(null);

  private disc?: Discovery;
  private tokens?: StoredTokens;

  /** APP_INITIALIZER: discover the IdP + finish any pending login redirect. */
  async init(): Promise<void> {
    if (!this.enabled) return;
    // Discovery is a background fetch(); it hard-fails when the IdP serves a TLS
    // cert the browser doesn't trust (e.g. a private-CA Keycloak) — and a
    // background request can't be click-through'd the way a full-page navigation
    // can. Don't let that dead-end login: fall back to the well-known Keycloak
    // endpoints derived from the issuer, so the login REDIRECT still fires (the
    // user accepts the IdP cert there) instead of the Sign-in button silently
    // doing nothing.
    try {
      this.disc = await this.discover();
    } catch (e) {
      console.error('OIDC discovery failed; falling back to issuer-derived endpoints', e);
      this.disc = keycloakFallback(ISSUER);
    }
    try {
      this.tokens = this.load();
      const p = new URLSearchParams(location.search);
      const code = p.get('code');
      const state = p.get('state');
      if (code && state) {
        await this.exchange(code, state);
        history.replaceState({}, '', location.pathname); // strip ?code&state from the URL
      }
      this.user.set(this.valid() ? this.username() : null);
    } catch (e) {
      console.error('OIDC init failed', e);
    }
  }

  isAuthenticated(): boolean {
    return !this.enabled || this.user() !== null;
  }

  /** A non-expired bearer for the gateway; refreshes first if near expiry. */
  async freshToken(): Promise<string | null> {
    if (!this.enabled) return null;
    if (this.valid()) return this.tokens!.id_token;
    if (this.tokens?.refresh_token) {
      try {
        await this.refresh();
        return this.valid() ? this.tokens!.id_token : null;
      } catch {
        this.clear();
        this.user.set(null);
        return null;
      }
    }
    return null;
  }

  /** Best-effort synchronous token, for the console WebSocket URL. */
  token(): string | null {
    return this.enabled && this.valid() ? this.tokens!.id_token : null;
  }

  /** Start the Authorization-Code + PKCE redirect to the IdP. */
  async login(): Promise<void> {
    if (!this.enabled) return;
    this.error.set(null);
    const disc = this.disc ?? keycloakFallback(ISSUER);
    if (!disc) {
      // No silent failure (KubeSwift principle #6): say why nothing happened.
      this.error.set(
        'Cannot start sign-in: the identity provider could not be reached. Check that ' +
          'the OIDC issuer is reachable and its TLS certificate is trusted by this browser.',
      );
      return;
    }
    try {
      const verifier = randomString(64);
      const challenge = await s256(verifier);
      const state = randomString(32);
      sessionStorage.setItem('kubeswift.oidc.verifier', verifier);
      sessionStorage.setItem('kubeswift.oidc.state', state);
      const p = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: redirectUri(),
        scope: 'openid profile email',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      location.assign(`${disc.authorization_endpoint}?${p.toString()}`);
    } catch (e) {
      this.error.set('Sign-in could not start; see the browser console for details.');
      console.error('OIDC login failed', e);
    }
  }

  logout(): void {
    const hint = this.tokens?.id_token;
    this.clear();
    this.user.set(null);
    if (this.disc?.end_session_endpoint && hint) {
      const p = new URLSearchParams({
        id_token_hint: hint,
        post_logout_redirect_uri: location.origin,
      });
      location.assign(`${this.disc.end_session_endpoint}?${p.toString()}`);
    } else {
      location.assign(location.origin);
    }
  }

  // --- internals ---

  private async discover(): Promise<Discovery> {
    const r = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status}`);
    return r.json();
  }

  private async exchange(code: string, state: string): Promise<void> {
    if (state !== sessionStorage.getItem('kubeswift.oidc.state'))
      throw new Error('OIDC state mismatch');
    const verifier = sessionStorage.getItem('kubeswift.oidc.verifier') ?? '';
    const t = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });
    this.store(t);
    sessionStorage.removeItem('kubeswift.oidc.verifier');
    sessionStorage.removeItem('kubeswift.oidc.state');
  }

  private async refresh(): Promise<void> {
    if (!this.tokens?.refresh_token) throw new Error('no refresh token');
    this.store(
      await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refresh_token,
      }),
    );
  }

  private async tokenRequest(fields: Record<string, string>): Promise<Record<string, unknown>> {
    const disc = this.disc ?? keycloakFallback(ISSUER);
    if (!disc) throw new Error('no token endpoint');
    const body = new URLSearchParams({ client_id: CLIENT_ID, ...fields });
    const r = await fetch(disc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) throw new Error(`OIDC token request failed: ${r.status}`);
    return r.json();
  }

  private store(t: Record<string, unknown>): void {
    const expiresIn = Number(t['expires_in'] ?? 300);
    this.tokens = {
      id_token: String(t['id_token'] ?? this.tokens?.id_token ?? ''),
      access_token: t['access_token'] ? String(t['access_token']) : undefined,
      refresh_token: t['refresh_token'] ? String(t['refresh_token']) : this.tokens?.refresh_token,
      expires_at: Date.now() + expiresIn * 1000,
    };
    localStorage.setItem(STORE, JSON.stringify(this.tokens));
    this.user.set(this.username());
  }

  private load(): StoredTokens | undefined {
    const raw = localStorage.getItem(STORE);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as StoredTokens;
    } catch {
      return undefined;
    }
  }

  private clear(): void {
    this.tokens = undefined;
    localStorage.removeItem(STORE);
  }

  private valid(): boolean {
    return !!this.tokens?.id_token && Date.now() < this.tokens.expires_at - 15000;
  }

  private username(): string | null {
    if (!this.tokens?.id_token) return null;
    try {
      const c = decodeJwt(this.tokens.id_token);
      return (
        (c['email'] as string) ??
        (c['preferred_username'] as string) ??
        (c['sub'] as string) ??
        null
      );
    } catch {
      return null;
    }
  }
}

// --- helpers (browser-native crypto/encoding) ---

function redirectUri(): string {
  return location.origin + '/';
}

/**
 * Well-known OIDC endpoints for a Keycloak realm issuer, derived from the issuer
 * URL. Used as a fallback when the discovery document cannot be fetched from the
 * browser — the usual cause is the IdP serving a private-CA TLS cert the browser
 * doesn't trust, so a background fetch() to it hard-fails with no click-through
 * (unlike a full-page navigation). Returns undefined for a non-Keycloak issuer
 * (no trailing /realms/<realm>), where discovery is the only way to learn the
 * endpoints.
 */
function keycloakFallback(issuer: string): Discovery | undefined {
  if (!/\/realms\/[^/]+$/.test(issuer)) return undefined;
  const base = `${issuer}/protocol/openid-connect`;
  return {
    authorization_endpoint: `${base}/auth`,
    token_endpoint: `${base}/token`,
    end_session_endpoint: `${base}/logout`,
  };
}

function randomString(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64url(bytes).slice(0, len);
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeJwt(jwt: string): Record<string, unknown> {
  let p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  p += '='.repeat((4 - (p.length % 4)) % 4);
  return JSON.parse(atob(p));
}
