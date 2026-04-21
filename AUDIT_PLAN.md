# AUDIT_PLAN.md

## Summary
- Convert the audit into four buckets: `Act now`, `Act after decision`, `Monitor / sunset`, and `Reject`.
- Collapse duplicate symptoms into shared root-cause entries.
- Treat changes near recent refactors as coupled: `edfcaf2` owns sentinel/reconciliation paths; `277df5b` / `9770528` / `efef568` own template-editor/template-schema paths.

## Act now

1. Tracked-config hygiene.
Change: add `js/config.js` to `.gitignore`, remove it from git with `git rm --cached`, and keep a production-safe tracked template in `js/config.example.js`. Verify the active local `js/config.js` did not change during the untracking step.
Expected diff shape: `.gitignore` update, tracked `js/config.js` removal, template hardening in `js/config.example.js`, and setup-doc adjustments.
Covers: the production footgun of shipping a tracked `common` tenant config without waiting on the longer config-supply-model decision.
Interaction: independent of the later config-supply-model decision; local runtime behavior stays driven by the developer's untracked `js/config.js`.

2. Preserve Graph auth failure detail and cover recovery branches.
Change: update `js/m365.js` so `getAccessToken()` and `graphRequest()` preserve the real MSAL failure reason instead of collapsing everything to `"Could not get a Microsoft Graph access token."`; keep `null` only for the explicit recent-popup-dismiss path. Add tests in `tests/m365.test.js` for silent->popup failure detail surfacing, existing-event `PATCH` falling back to `POST`, and sentinel-extension `PATCH 404 -> POST`.
Expected diff shape: small helper/classifier in `js/m365.js` plus 3-5 targeted tests, no UI redesign.
Covers: swallowed `getAccessToken` errors and untested Graph recovery branches.
Interaction: same file cluster as the recent sentinel/reconciliation refactor in `edfcaf2`; do not change sentinel payload shape.

3. Add a regression net for Smart Fill’s two-pass scheduler.
Change: extend `tests/scheduler.test.js` with scenarios where phase gates, locked anchors, and availability windows interact, asserting that pass 1 places dates correctly and pass 2 respects time windows without crossing phase boundaries. Only extract a pure helper from `js/scheduler.js` if direct testing is too brittle.
Expected diff shape: test-heavy change; optional helper extraction with no intended behavior change.
Covers: the untested dates-then-times ordering path.
Interaction: avoid opportunistic scheduler refactors; this logic was last materially changed in `95f0b27`.

4. Correct setup/doc drift that can misconfigure tenants.
Change: update `ENTRA_SETUP.md` to fix the broken `config.js` / `m365.js` anchors, add the missing explanation that absent shared-calendar access leaves PM projects in `handed_off_pending_is`, and point operators to the tenant-choice comments instead of the wrong line references.
Expected diff shape: doc-only edits.
Covers: wrong anchors and missing setup guidance with real operator impact.

5. Remove confirmed dead exports and inert duplicate helpers.
Change: first confirm the v1/v2 sentinel reader still accepts the normalized-project shape the dead `serializeSentinelProjects()` helper could have written, then delete unused exports from `js/state.js`, `js/projects.js`, `js/scheduler.js`, and `js/conflicts.js`: `STORAGE_EXCEPTION_NOTE`, `projectIsComplete`, `mergeDeepLinkProject`, `serializeSentinelProjects`, `pushableCount`, `visibleSessions`, `getReviewableConflictCount`, `getCalendarConflictsForDate`, `isPastDateTime`, and `normalizeEventDate`.
Expected diff shape: delete-only cleanup; update imports/tests only if the export surface is referenced indirectly.
Covers: dead code and duplicated-but-unused helper paths.
Interaction: the `projects.js` removals sit next to live deep-link/sentinel code touched by `edfcaf2`; keep `applyDeepLinkProject()` and `serializeProjectsForSentinel()` untouched.

## Resolved decisions

- Runtime config supply model.
Decision made: use a tracked `js/config.js` runtime bootstrap that sets `window.__TRAINING_PLANNER_CONFIG__`, with `js/config.example.js` retained as a clean placeholder/reference copy and `js/runtime-config.js` as the tracked reader module.
Implemented in: `index.html`, `js/runtime-config.js`, `js/config.js`, `js/config.example.js`, `README.md`, `ENTRA_SETUP.md`.

- Sentinel and event write durability.
Decision made: use optimistic concurrency with `If-Match` and retry once for sentinel writes; keep Graph side effects when calendar writes succeed but sentinel persistence fails, and surface partial-commit errors explicitly.
Implemented in: `js/m365.js`, `tests/m365.test.js`.

- Template authoring contract.
Decision made: strict writes, tolerant reads. Authored templates use `durationMinutes` as the canonical field, keep explicit `bodyKey` or `null`, and library drafts do not commit until saved.
Implemented in: `js/template-schema.js`, `js/template-editor.js`, `js/app.js`, `js/render.js`, `tests/template-editor.test.js`.

- Built-in template duplication strategy.
Decision made: keep manufacturing and warehousing as separate fully-authored templates, and lock the intentional differences in tests instead of deriving both from a shared base.
Implemented in: `tests/template-schema.test.js`.

- Scope and config governance.
Decision made: remove unused people lookup and `People.Read`; keep config explicit in a tracked runtime bootstrap rather than a local-only file.
Implemented in: `js/config.js`, `js/config.example.js`, `js/m365.js`, `js/state.js`, `js/app.js`, `ENTRA_SETUP.md`.

- MSAL supply-chain policy.
Decision made: vendor MSAL locally instead of trusting CDN loading at runtime.
Implemented in: `vendor/msal-browser-2.39.0.min.js`, `vendor/README.md`, `index.html`, `js/m365.js`, `ENTRA_SETUP.md`.

- Legacy sentinel migration removal.
Decision made: remove `[TP] Project Index` compatibility entirely because the app is not live and no migration population exists.
Implemented in: `js/m365.js`.

- Day-view state ownership.
Decision made: mirror `pendingCommit` and `currentSessionId` into `state.ui.dayView`, while leaving the rest of the modal state module-local.
Implemented in: `js/dayview.js`, `js/state.js`.

## Monitor / sunset

- Narrow focus restoration in `js/render.js`.
Leave the current `input` / `textarea` / `select` restore contract in place. Review by `2026-07-01`, or sooner if a concrete keyboard/accessibility bug reports lost focus on a `button`, `[contenteditable]`, or `[tabindex]` control.

- Legacy export compatibility style in `js/clientplan.js`.
Keep the pre-ES6 generator until the supported Outlook/WebView matrix is explicitly documented. Review by `2026-09-01`.

## Reject

- `getSessionBody` "silent empty string" fix.
The current implementations in `js/session-templates.js` and `js/template-schema.js` already fall back to generic copy, so the audited symptom is overstated. Reopen only with a reproducible blank-body path.

- Render-shell self-healing against arbitrary DOM deletion.
Hardening `ensureRenderShell()` against external scripts deleting `#toast` adds watchdog complexity around a condition the app itself does not create.

- `tp-doc-*` versus `tp-*` namespace mismatch.
Intentional export/app isolation; "cleaning it up" risks collisions for little gain.

## Public interfaces / behavior notes
- None of the `Act now` items should change sentinel payload shape, deep-link wire shape, or project runtime semantics.
- Deferred scope, template, sentinel, day-view, MSAL, and config-supply decisions have now been implemented.

## Verification
- Keep `npm test` green.
- Keep the targeted coverage added in `tests/m365.test.js`, `tests/scheduler.test.js`, and template/day-view regression tests green.
- Keep the setup docs aligned with the runtime `js/config.js` bootstrap workflow and tenant-choice guidance.

## Assumptions
- Findings were consolidated when they describe the same underlying issue with multiple surface symptoms.
- Recent refactor ownership was inferred from current history: `edfcaf2` for sentinel/reconciliation, `277df5b` / `9770528` / `efef568` for template-editor/template-schema.
- This block is the intended `AUDIT_PLAN.md` content; no repo files are modified in Plan Mode.
