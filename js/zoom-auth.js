import {
  ZOOM_CLIENT_ID,
  ZOOM_OAUTH_BASE,
  ZOOM_SCOPES,
  isPlaceholderZoomValue,
} from "./runtime-config.js";

const TOKEN_STORAGE_KEY = "tp.zoomToken";
const STATE_STORAGE_KEY = "tp.zoomAuthState";
const VERIFIER_STORAGE_KEY = "tp.zoomAuthVerifier";
const RESULT_STORAGE_KEY = "tp.zoomAuthResult";
const REDIRECT_PATH = "zoom-callback.html";
const POPUP_FEATURES = "width=520,height=720,menubar=no,status=no,toolbar=no";
const POPUP_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_LEEWAY_SECONDS = 60;

const authStatusListeners = new Set();
let authStatus = { state: "unknown", message: "" };
let pendingAuth = null;
let testFetchImpl = null;
let testCryptoImpl = null;

function setAuthStatus(state, message = "") {
  authStatus = { state, message };
  authStatusListeners.forEach((listener) => {
    try {
      listener(authStatus);
    } catch (error) {
      /* ignore */
    }
  });
}

export function onZoomAuthStatusChange(listener) {
  if (typeof listener !== "function") return () => {};
  authStatusListeners.add(listener);
  listener(authStatus);
  return () => authStatusListeners.delete(listener);
}

export function getZoomAuthStatus() {
  return { ...authStatus };
}

export function hasZoomConfig() {
  return !isPlaceholderZoomValue(ZOOM_CLIENT_ID);
}

function getCrypto() {
  if (testCryptoImpl) return testCryptoImpl;
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) return globalThis.crypto;
  return null;
}

function getFetch() {
  if (testFetchImpl) return testFetchImpl;
  if (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  return null;
}

function sessionStore() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.sessionStorage) return globalThis.sessionStorage;
  } catch (error) {
    return null;
  }
  return null;
}

function base64UrlEncode(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBytes(length) {
  const crypto = getCrypto();
  if (!crypto) throw new Error("Web Crypto API is unavailable.");
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function buildPkcePair() {
  const verifier = base64UrlEncode(randomBytes(48));
  const crypto = getCrypto();
  if (!crypto?.subtle) throw new Error("SubtleCrypto is unavailable.");
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return { verifier, challenge: base64UrlEncode(digest) };
}

function getRedirectUri() {
  if (typeof globalThis === "undefined" || !globalThis.location) {
    return REDIRECT_PATH;
  }
  return new URL(REDIRECT_PATH, globalThis.location.href).toString();
}

function readToken() {
  const store = sessionStore();
  if (!store) return null;
  try {
    const raw = store.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.accessToken) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function writeToken(token) {
  const store = sessionStore();
  if (!store) return;
  try {
    store.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
  } catch (error) {
    /* ignore */
  }
}

function clearStoredAuth(includeToken = true) {
  const store = sessionStore();
  if (!store) return;
  try {
    store.removeItem(STATE_STORAGE_KEY);
    store.removeItem(VERIFIER_STORAGE_KEY);
    store.removeItem(RESULT_STORAGE_KEY);
    if (includeToken) store.removeItem(TOKEN_STORAGE_KEY);
  } catch (error) {
    /* ignore */
  }
}

function tokenIsFresh(token) {
  if (!token || !token.accessToken) return false;
  if (!Number.isFinite(token.expiresAt)) return true;
  return token.expiresAt - REFRESH_LEEWAY_SECONDS * 1000 > Date.now();
}

async function exchangeCodeForToken({ code, verifier }) {
  const fetchImpl = getFetch();
  if (!fetchImpl) throw new Error("Fetch API is unavailable.");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    client_id: ZOOM_CLIENT_ID,
    code_verifier: verifier,
  });
  const response = await fetchImpl(`${ZOOM_OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Zoom token exchange failed (${response.status}): ${detail || response.statusText}`);
  }
  const data = await response.json();
  return normaliseTokenResponse(data);
}

async function refreshAccessToken(refreshToken) {
  const fetchImpl = getFetch();
  if (!fetchImpl) throw new Error("Fetch API is unavailable.");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: ZOOM_CLIENT_ID,
  });
  const response = await fetchImpl(`${ZOOM_OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Zoom token refresh failed (${response.status}): ${detail || response.statusText}`);
  }
  const data = await response.json();
  return normaliseTokenResponse(data);
}

function normaliseTokenResponse(data = {}) {
  const expiresInSeconds = Number(data.expires_in) || 0;
  return {
    accessToken: String(data.access_token || ""),
    refreshToken: String(data.refresh_token || ""),
    scope: String(data.scope || ""),
    expiresAt: expiresInSeconds > 0 ? Date.now() + expiresInSeconds * 1000 : 0,
  };
}

async function runInteractiveAuth() {
  if (typeof globalThis === "undefined" || !globalThis.window) {
    throw new Error("Interactive Zoom auth requires a browser window.");
  }
  if (!hasZoomConfig()) {
    throw new Error("Zoom client ID is not configured.");
  }
  const { verifier, challenge } = await buildPkcePair();
  const state = base64UrlEncode(randomBytes(16));
  const store = sessionStore();
  if (store) {
    try {
      store.setItem(STATE_STORAGE_KEY, state);
      store.setItem(VERIFIER_STORAGE_KEY, verifier);
      store.removeItem(RESULT_STORAGE_KEY);
    } catch (error) {
      /* ignore */
    }
  }
  const authorizeUrl = new URL(`${ZOOM_OAUTH_BASE}/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", ZOOM_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", getRedirectUri());
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  if (Array.isArray(ZOOM_SCOPES) && ZOOM_SCOPES.length) {
    authorizeUrl.searchParams.set("scope", ZOOM_SCOPES.join(" "));
  }
  const popup = globalThis.window.open(authorizeUrl.toString(), "tp-zoom-auth", POPUP_FEATURES);
  if (!popup) {
    throw new Error("Zoom sign-in popup was blocked. Allow popups and try again.");
  }
  const expectedOrigin = new URL(getRedirectUri()).origin;
  const result = await waitForAuthResult(popup, state, expectedOrigin);
  if (result.error) {
    throw new Error(result.errorDescription || result.error || "Zoom authorisation was cancelled.");
  }
  if (!result.code) {
    throw new Error("Zoom authorisation did not return a code.");
  }
  const token = await exchangeCodeForToken({ code: result.code, verifier });
  if (!token.accessToken) {
    throw new Error("Zoom did not return an access token.");
  }
  writeToken(token);
  clearStoredAuth(false);
  return token;
}

function waitForAuthResult(popup, expectedState, expectedOrigin) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearInterval(closedPoll);
      window.clearInterval(storagePoll);
      window.clearTimeout(timeoutHandle);
      if (error) reject(error); else resolve(value);
    };
    const onMessage = (event) => {
      if (!event || typeof event.data !== "object" || event.data === null) return;
      if (event.data.type !== "tp-zoom-auth-result") return;
      if (expectedOrigin && event.origin !== expectedOrigin) return;
      if (event.data.state !== expectedState) return;
      finish(event.data, null);
    };
    window.addEventListener("message", onMessage);
    const closedPoll = window.setInterval(() => {
      if (popup.closed) {
        const fallback = readResultFromSessionStorage(expectedState);
        if (fallback) {
          finish(fallback, null);
        } else {
          finish(null, new Error("Zoom sign-in was cancelled."));
        }
      }
    }, 400);
    const storagePoll = window.setInterval(() => {
      const fallback = readResultFromSessionStorage(expectedState);
      if (fallback) finish(fallback, null);
    }, 600);
    const timeoutHandle = window.setTimeout(() => {
      try { popup.close(); } catch (error) { /* ignore */ }
      finish(null, new Error("Zoom sign-in timed out."));
    }, POPUP_TIMEOUT_MS);
  });
}

function readResultFromSessionStorage(expectedState) {
  const store = sessionStore();
  if (!store) return null;
  try {
    const raw = store.getItem(RESULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.state !== expectedState) return null;
    store.removeItem(RESULT_STORAGE_KEY);
    return parsed;
  } catch (error) {
    return null;
  }
}

export async function acquireZoomToken({ interactive = false } = {}) {
  if (!hasZoomConfig()) {
    setAuthStatus("not_configured", "Zoom is not configured.");
    return null;
  }
  if (pendingAuth) return pendingAuth;

  const token = readToken();
  if (tokenIsFresh(token)) {
    setAuthStatus("connected");
    return token.accessToken;
  }
  if (token?.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(token.refreshToken);
      if (refreshed.accessToken) {
        writeToken(refreshed);
        setAuthStatus("connected");
        return refreshed.accessToken;
      }
    } catch (error) {
      /* fall through to interactive */
    }
  }
  if (!interactive) {
    setAuthStatus("disconnected", "Zoom is not connected.");
    return null;
  }

  setAuthStatus("connecting", "Opening Zoom sign-in.");
  pendingAuth = (async () => {
    try {
      const freshToken = await runInteractiveAuth();
      setAuthStatus("connected");
      return freshToken.accessToken;
    } catch (error) {
      setAuthStatus("error", error.message || String(error));
      throw error;
    } finally {
      pendingAuth = null;
    }
  })();
  return pendingAuth;
}

export function signOutZoom() {
  clearStoredAuth(true);
  setAuthStatus("disconnected", "Zoom signed out.");
}

export function __setZoomTokenForTests(token) {
  if (!token) {
    clearStoredAuth(true);
    setAuthStatus("unknown");
    return;
  }
  writeToken({ expiresAt: Date.now() + 3600_000, ...token });
  setAuthStatus("connected");
}

export function __setZoomTestImpls({ fetch: fetchImpl, crypto: cryptoImpl } = {}) {
  testFetchImpl = typeof fetchImpl === "function" ? fetchImpl : null;
  testCryptoImpl = cryptoImpl || null;
}
