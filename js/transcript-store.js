const STORAGE_PREFIX = "tp.transcript.";
const SUMMARY_PREFIX = "tp.zoomSummary.";
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function storage() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  } catch (error) {
    return null;
  }
  return null;
}

function readEntry(key) {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (Number.isFinite(parsed.expiresAt) && parsed.expiresAt < Date.now()) {
      store.removeItem(key);
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

function writeEntry(key, payload, ttlMs) {
  const store = storage();
  if (!store) return false;
  try {
    const expiresAt = Date.now() + (Number.isFinite(ttlMs) ? Number(ttlMs) : DEFAULT_TTL_MS);
    store.setItem(key, JSON.stringify({ ...payload, expiresAt }));
    return true;
  } catch (error) {
    return false;
  }
}

function removeEntry(key) {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(key);
    return true;
  } catch (error) {
    return false;
  }
}

export function getCachedTranscript(sessionId) {
  if (!sessionId) return null;
  return readEntry(STORAGE_PREFIX + sessionId);
}

export function setCachedTranscript(sessionId, payload = {}, ttlMs) {
  if (!sessionId) return false;
  return writeEntry(STORAGE_PREFIX + sessionId, payload, ttlMs);
}

export function clearCachedTranscript(sessionId) {
  if (!sessionId) return false;
  return removeEntry(STORAGE_PREFIX + sessionId);
}

export function getCachedSummary(sessionId) {
  if (!sessionId) return null;
  return readEntry(SUMMARY_PREFIX + sessionId);
}

export function setCachedSummary(sessionId, payload = {}, ttlMs) {
  if (!sessionId) return false;
  return writeEntry(SUMMARY_PREFIX + sessionId, payload, ttlMs);
}

export function clearCachedSummary(sessionId) {
  if (!sessionId) return false;
  return removeEntry(SUMMARY_PREFIX + sessionId);
}

export const __DEFAULT_TTL_MS = DEFAULT_TTL_MS;
