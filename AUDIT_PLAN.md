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

## Act after decision

- Sentinel and event write durability.
Decision needed: what consistency guarantee the app should make for concurrent sentinel writes and partially failed calendar pushes.
Options: add optimistic concurrency with `If-Match` and retry once; or accept last-write-wins and surface that behavior explicitly.
Covers: sentinel writes with no CAS and rollback-delete failure leaving live orphan events.
Touch points: `js/m365.js`, sentinel state UI, reconciliation tests.
Interaction: directly inside the `edfcaf2` refactor surface.

- Template authoring contract.
Decision needed: whether template editing remains permissive/auto-healing or becomes explicit/authored.
Options: keep aliases/fallbacks and add warnings only; make `durationMinutes` the single authored field and require explicit `bodyKey` or `null`; split draft state from committed library state so library changes apply only on save/export.
Covers: duplicated `duration` / `durationMinutes`, implicit `bodyKey <- key`, eager draft commits to the library, and the general mismatch between author intent and runtime normalization.
Touch points: `js/template-schema.js`, `js/template-editor.js`, `js/projects.js`, `js/deeplink.js`, template tests.
Interaction: owned by the recent template-editor/template-schema work in `277df5b`, `9770528`, and `efef568`.

- Built-in template duplication strategy.
Decision needed: are manufacturing and warehousing separate fully-authored templates, or variants of one base?
Options: keep two explicit definitions and document intentional diffs in tests; derive both from a shared base plus overrides; encode allowed divergence in metadata/fixtures.
Covers: near-copy built-in templates with unclear intentional drift.
Touch points: `js/session-templates.js`, parity fixtures/tests.
Interaction: same template-editing cluster as above.

- Scope and config governance.
Decision needed: how runtime config is supplied, and whether people lookup is still a supported feature.
Options: keep tracked `js/config.js` but make it production-safe; track only `js/config.example.js` and ignore local `js/config.js`; move config injection to deploy/runtime.
If `People.Read` is dropped: remove `searchPeople()`, `people*` state, and the scope entry together. If it stays: wire an actual caller and test it.
Covers: tracked `js/config.js` with `GRAPH_TENANT_ID = "common"`, `config.example.js` not modeling tenant choice, empty `.gitignore`, and likely-unused `People.Read`.
Touch points: `js/config.js`, `js/config.example.js`, `.gitignore`, `ENTRA_SETUP.md`, `js/m365.js`, `js/state.js`, `js/app.js`.

- MSAL supply-chain policy.
Decision needed: what external-script trust model is acceptable for this no-bundler SPA.
Options: vendor MSAL locally; keep CDN loading but restrict to Microsoft-hosted origins with integrity pinning; keep the current multi-CDN fallback.
Covers: missing SRI and fallback to non-Microsoft CDNs.
Touch points: `js/m365.js`, possibly `index.html`.

- Legacy sentinel migration removal.
Decision needed: whether any tenant still needs `[TP] Project Index` compatibility.
Options: remove now and document manual migration; keep until a fixed sunset date; keep permanently.
Covers: `LEGACY_SENTINEL_SUBJECT` still running on live sentinel fetch/write paths.
Touch points: `js/m365.js`.
Interaction: sentinel/reconciliation code owned by `edfcaf2`.

- Day-view state ownership.
Decision needed: whether day-view review state is intentionally modal-local or should be globally observable.
Options: keep local state and add targeted reset/close guards; mirror `pendingCommit/currentSessionId` into `state.ui`; move the full model into `state.ui.dayView`.
Covers: module-scoped `dayViewState` bypassing central UI state.
Touch points: `js/dayview.js`, `js/state.js`, `js/render.js`, `js/app.js`.

## Monitor / sunset

- Narrow focus restoration in `js/render.js`.
Leave the current `input` / `textarea` / `select` restore contract in place. Review by `2026-07-01`, or sooner if a concrete keyboard/accessibility bug reports lost focus on a `button`, `[contenteditable]`, or `[tabindex]` control.

- Legacy export compatibility style in `js/clientplan.js`.
Keep the pre-ES6 generator until the supported Outlook/WebView matrix is explicitly documented. Review by `2026-09-01`.

- Legacy sentinel migration if the removal decision is deferred.
If no decision is made now, record a hard re-review date of `2026-07-01` so the compatibility branch does not become permanent by inertia.

- Repo-root `README.md`.
Defer until the current audit-plan changes land. Review after this plan lands rather than treating it as rejected work.

## Reject

- `getSessionBody` "silent empty string" fix.
The current implementations in `js/session-templates.js` and `js/template-schema.js` already fall back to generic copy, so the audited symptom is overstated. Reopen only with a reproducible blank-body path.

- Render-shell self-healing against arbitrary DOM deletion.
Hardening `ensureRenderShell()` against external scripts deleting `#toast` adds watchdog complexity around a condition the app itself does not create.

- `tp-doc-*` versus `tp-*` namespace mismatch.
Intentional export/app isolation; "cleaning it up" risks collisions for little gain.

## Public interfaces / behavior notes
- None of the `Act now` items should change sentinel payload shape, deep-link wire shape, or project runtime semantics.
- Any decision on scopes, config provisioning, template authoring strictness, or legacy sentinel removal is an external-behavior change and should land in a separate implementation pass.

## Verification
- Keep `npm test` green.
- Add targeted coverage in `tests/m365.test.js` and `tests/scheduler.test.js`.
- After the config/scope decision lands, add one explicit setup-path smoke check or checklist update for the chosen tenant workflow.

## Assumptions
- Findings were consolidated when they describe the same underlying issue with multiple surface symptoms.
- Recent refactor ownership was inferred from current history: `edfcaf2` for sentinel/reconciliation, `277df5b` / `9770528` / `efef568` for template-editor/template-schema.
- This block is the intended `AUDIT_PLAN.md` content; no repo files are modified in Plan Mode.
