import test from "node:test";
import assert from "node:assert/strict";

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

// Install storage shim before loading the module — the module reads
// globalThis.localStorage lazily on every call, so resetting between tests is enough.
globalThis.localStorage = createMemoryStorage();
const {
  clearCachedTranscript,
  getCachedSummary,
  getCachedTranscript,
  setCachedSummary,
  setCachedTranscript,
} = await import("../js/transcript-store.js");

test.beforeEach(() => globalThis.localStorage.clear());

test("setCachedTranscript / getCachedTranscript round-trip", () => {
  setCachedTranscript("session-1", { vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nhello" });
  const entry = getCachedTranscript("session-1");
  assert.ok(entry);
  assert.match(entry.vtt, /WEBVTT/);
});

test("getCachedTranscript returns null for unknown session id", () => {
  assert.equal(getCachedTranscript("missing"), null);
});

test("clearCachedTranscript removes the entry", () => {
  setCachedTranscript("session-1", { vtt: "abc" });
  clearCachedTranscript("session-1");
  assert.equal(getCachedTranscript("session-1"), null);
});

test("expired transcript entries are evicted on read", () => {
  const past = Date.now() - 1000;
  globalThis.localStorage.setItem(
    "tp.transcript.expired",
    JSON.stringify({ vtt: "old", expiresAt: past })
  );
  assert.equal(getCachedTranscript("expired"), null);
  assert.equal(globalThis.localStorage.getItem("tp.transcript.expired"), null);
});

test("summary cache uses a separate namespace", () => {
  setCachedTranscript("session-2", { vtt: "trans" });
  setCachedSummary("session-2", { summary: "sum" });
  assert.equal(getCachedTranscript("session-2").vtt, "trans");
  assert.equal(getCachedSummary("session-2").summary, "sum");
});
