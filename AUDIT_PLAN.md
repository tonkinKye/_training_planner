# AUDIT_PLAN.md

## Summary

The 2026-04-21 re-audit closeout is implemented. Remaining items are either accepted current-state choices, monitor-only items, or explicit rejects.

## Closed In This Pass

- Replaced stale audit content with the 2026-04-21 re-audit in [AUDIT.md](AUDIT.md).
- Kept the tracked `js/config.js` runtime bootstrap and intentionally left the repo default on `GRAPH_TENANT_ID: "common"` as an accepted dev setup for now.
- Removed template/runtime helper duplication by moving both generated and live `session-templates` helpers onto one canonical implementation path in [js/template-schema.js](js/template-schema.js).
- Canonicalized internal session duration handling to `durationMinutes`, while keeping legacy `duration` support only at compatibility boundaries.
- Removed the second wave of dead exports from `state.js`, `utils.js`, `projects.js`, and `template-editor.js`.
- Hardened `m365` auth/runtime behavior by removing shared `lastMsalError` state and gating test-only hooks to Node/test contexts.
- Removed the empty repo-root `styles/` directory.

## Accepted Current State

- Tracked dev tenant config.
Decision: keep [js/config.js](js/config.js) tracked and leave `GRAPH_TENANT_ID: "common"` in place as the current repo-default dev configuration.
Why: this pass was explicitly scoped to keep the tracked dev tenant mode unchanged rather than treat it as a production-hardening bug.
Implication: production deployments must still replace the tracked config values with tenant-specific settings.

## Monitor / sunset

- Narrow focus restoration in [js/render.js](js/render.js).
Leave the current `input` / `textarea` / `select` restore contract in place. Review by `2026-07-01`, or sooner if a concrete keyboard/accessibility bug reports lost focus on a `button`, `[contenteditable]`, or `[tabindex]` control.

- Legacy export compatibility style in [js/clientplan.js](js/clientplan.js).
Keep the pre-ES6 generator until the supported Outlook/WebView matrix is explicitly documented. Review by `2026-09-01`.

## Reject

- `getSessionBody` "silent empty string" fix.
The current helper chain already falls back to generic copy. Reopen only with a reproducible blank-body path.

- Render-shell self-healing against arbitrary DOM deletion.
Hardening `ensureRenderShell()` against external scripts deleting `#toast` adds watchdog complexity around a condition the app itself does not create.

- `tp-doc-*` versus `tp-*` namespace mismatch.
Intentional export/app isolation; changing it risks collisions for little gain.

## Verification

- `npm test` passes `94/94`.
- The audit record, setup docs, and runtime behavior now match each other on auth callback flow, vendored MSAL, tracked runtime config, and the intentional `common` dev-tenant default.
