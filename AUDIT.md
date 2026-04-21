# Training Planner Re-Audit

Date: 2026-04-21

Scope: verify fixes from the prior audit and surface remaining or newly visible issues. This is not a fresh full-survey; it builds on the earlier audit and closes out the remaining confirmed cleanup items completed in this pass.

## 1. Fixes confirmed

- MSAL is vendored locally. [vendor/msal-browser-2.39.0.min.js](vendor/msal-browser-2.39.0.min.js) is loaded directly from [index.html](index.html), and `ensureMsalLoaded()` in [js/m365.js](js/m365.js) now throws if the global is missing instead of fetching from CDNs. Upgrade procedure is documented in [vendor/README.md](vendor/README.md).
- Graph auth error detail is preserved. `createGraphAuthError()` in [js/m365.js](js/m365.js) wraps MSAL failures with `name: "GraphAuthError"` and preserves `message` and `cause`. `getAccessToken()` still returns `null` only for a recent popup dismiss. Covered in [tests/m365.test.js](tests/m365.test.js).
- Sentinel write durability is implemented. `writeSentinelWithRetry()` in [js/m365.js](js/m365.js) reads ETags, writes with `If-Match`, and on `409` or `412` re-reads, merges remote-only projects, and retries once. Covered in [tests/m365.test.js](tests/m365.test.js).
- Graph recovery branches are covered. Existing-event `PATCH` falls back to `POST`, and sentinel extension `PATCH` falls back to `POST` on `404`. Covered in [tests/m365.test.js](tests/m365.test.js).
- Smart Fill now has a two-pass regression net. [tests/scheduler.test.js](tests/scheduler.test.js) covers phase gates, locked anchors, and availability windows across date placement and time placement.
- Runtime config bootstrap is in place. [js/config.js](js/config.js) sets `window.__TRAINING_PLANNER_CONFIG__`, [js/runtime-config.js](js/runtime-config.js) reads it, and [index.html](index.html) loads config before the app. The tracked `common` tenant value is intentionally left as the current dev default in this pass.
- `People.Read` and people lookup were removed. No live people-search path remains in the runtime or docs.
- Legacy `[TP] Project Index` subject compatibility is removed. Only the current sentinel identity remains live.
- Day-view review state is partially mirrored. `syncObservableReviewState()` in [js/dayview.js](js/dayview.js) writes `currentSessionId` and `pendingCommit` into `state.ui.dayView` while the rest of the modal stays module-local.
- Prior dead exports from the first audit pass are gone.
- ENTRA setup docs were corrected. Broken line anchors were removed, `handed_off_pending_is` is documented, the popup callback flow is explained, and the vendored MSAL workflow is documented.
- [auth-callback.html](auth-callback.html) exists at repo root as a minimal dedicated popup return page.
- The template-runtime duplication has been removed. [js/template-schema.js](js/template-schema.js) now provides a single canonical runtime-helper implementation that both the live exports and generated `session-templates` source use.
- Session duration is canonicalized internally as `durationMinutes`. Runtime code paths now consume `durationMinutes` first, with legacy `duration` handled only at compatibility boundaries such as old payload reads and legacy-friendly serialization.
- Newly dead exports identified in the re-audit have been removed from [js/state.js](js/state.js), [js/utils.js](js/utils.js), [js/projects.js](js/projects.js), and [js/template-editor.js](js/template-editor.js).
- `m365` test hooks are still exported for the Node test suite, but they are now hard-gated and throw immediately in browser contexts.
- The module-scoped `lastMsalError` sharing is gone. Auth failures now propagate per call instead of leaking across overlapping token requests.
- The empty repo-root `styles/` directory has been removed.
- Tests are green. `npm test` passes `94/94`.

## 2. Accepted current state

### 2.1 Tracked dev tenant config

[js/config.js](js/config.js) remains tracked and currently keeps `GRAPH_TENANT_ID: "common"` as the repo's accepted dev-default configuration. That is an intentional current-state choice for this pass, not an open bug to fix here.

Implication:

- a straight deployment from the current tracked config is still a dev-style setup
- production operators are expected to replace the tracked config values before a real tenant deployment

This is documented in [README.md](README.md) and [ENTRA_SETUP.md](ENTRA_SETUP.md). The runtime placeholder detector is unchanged by design in this pass.

## 3. Monitor / sunset

### 3.1 Narrow focus restoration in `render.js`

[js/render.js](js/render.js) still restores focus only for `input`, `textarea`, and `select`. Leave that contract in place unless a concrete keyboard or accessibility bug appears for `button`, `[contenteditable]`, or `[tabindex]` elements.

Review date: 2026-07-01.

### 3.2 Legacy export compatibility style in `clientplan.js`

[js/clientplan.js](js/clientplan.js) keeps its older compatibility-oriented style. Leave it until the supported Outlook/WebView matrix is explicitly documented.

Review date: 2026-09-01.

## 4. Reject

### 4.1 `getSessionBody` "silent empty string" fix

The current helper chain already falls back to generic copy. Reopen only with a reproducible blank-body path.

### 4.2 Render-shell self-healing against arbitrary DOM deletion

Hardening `ensureRenderShell()` against external deletion of `#toast` adds watchdog complexity around a condition the app itself does not create.

### 4.3 `tp-doc-*` versus `tp-*` namespace mismatch

That split remains intentional export/app isolation. Normalizing it would create risk without a real payoff.

## 5. Review gaps

- No linter or type checker is configured in-repo.
- No CI evidence exists in-repo; `npm test` remains the main gate.
- Browser-side behavior is still mostly unit-tested through modules rather than end-to-end in a live DOM/browser flow.
- There is still no full reconciliation integration test that exercises the shared-calendar read path end-to-end.
