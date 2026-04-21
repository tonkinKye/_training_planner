# Training Planner — Diagnostic Audit

## 1. Architecture map

**Runtime shell.** Single SPA, no bundler. [index.html](index.html) loads seven CSS files and one ES module entry [js/app.js](js/app.js). No build step; ESM resolved by the browser. No transpiler, no linter, no framework.

**Auth / Graph.** [js/m365.js](js/m365.js) (1589 lines) owns MSAL bootstrap, token acquisition, Graph request fan-out, deep-link handling, sentinel IO, PM/IS reconciliation, event push/rollback. MSAL is loaded at runtime from three fallback CDNs [js/m365.js:21-25](js/m365.js#L21-L25); configured with `cacheLocation: "sessionStorage"` [js/m365.js:90](js/m365.js#L90). Scopes declared in [js/config.js:6](js/config.js#L6): `Calendars.ReadWrite`, `Calendars.Read.Shared`, `People.Read`.

**State authority.** [js/state.js](js/state.js) (353 lines) owns the canonical mutable tree; domain modules mutate through its setters. Three subsystems keep *private* state that bypasses the tree:
- Template editor draft: `state.ui.templateEditor` — in-tree, but [js/template-editor.js](js/template-editor.js) commits drafts eagerly to `state.templateLibrary` (commitDraftToLibrary), so "dirty" only gates serialization, not the library contents.
- Day view: `dayViewState` module-scoped in [js/dayview.js](js/dayview.js) — not in `state.ui`.
- MSAL cache: `sessionStorage`, owned by the MSAL lib, not the app.

**Domain modules.** [js/projects.js](js/projects.js) (1265 lines) — project/phase/stage/session schema, lifecycle derivation, deep-link merge (legacy). [js/scheduler.js](js/scheduler.js) (1659 lines) — date/time validation, Smart Fill two-pass, range recompute. [js/conflicts.js](js/conflicts.js) (261 lines) — calendar overlap detection. [js/sentinel-model.js](js/sentinel-model.js) — v1/v2 sentinel payload shape. [js/session-templates.js](js/session-templates.js) — BUILT_IN_TEMPLATES library. [js/template-schema.js](js/template-schema.js) — normalization + validation + `buildSessionTemplatesModuleSource` code-gen. [js/dayview.js](js/dayview.js) — modal conflict-review loop.

**Presentation.** [js/render.js](js/render.js) (1393 lines) — three-slot render shell (topbar/main/overlays), `updateRenderSlot` diff-skips unchanged HTML and preserves focus for `input/textarea/select`. `RENDER_SHELL_HTML` at [js/render.js:36](js/render.js#L36) is the sole owner of the `#toast` element that `utils.js#toast` depends on.

**Boundaries.** Graph IO is siloed in m365.js (good). Calendar source planning isolated in [js/calendar-sources.js](js/calendar-sources.js). Client-facing HTML export isolated in [js/clientplan.js](js/clientplan.js) with its own `tp-doc-*` CSS namespace (separate from in-app `tp-*`).

**Cross-subsystem flows worth naming.**
- **Sentinel write path**: push session → update local project → `writeSentinel` serializes `state.projects` into an open-extension payload on a weekly recurring event.
- **Reconciliation path**: `reconcilePmProjects` / `reconcileIsProjects` cross-read mailboxes for drift, requires `Calendars.Read.Shared` and mailbox sharing.
- **Deep link**: base64url JSON; `applyDeepLinkProject` seeds but does not overwrite an existing project — tested at [tests/m365.test.js](tests/m365.test.js).

---

## 2. Inconsistencies and contradictions

**`STORAGE_EXCEPTION_NOTE` vs reality.** [js/state.js:4](js/state.js#L4) exports `"MSAL may use sessionStorage; application data must not."` Never imported anywhere in the repo (confirmed by grep). And MSAL *is* configured `cacheLocation: "sessionStorage"` at [js/m365.js:90](js/m365.js#L90) — so the comment is a dead note that also describes something the app actively does. Ironic, not harmful.

**Session duration duplication.** [js/template-schema.js](js/template-schema.js) normalizeSession writes both `duration` and `durationMinutes` on each session — two fields for the same value. Nothing guarantees they stay synchronized after later edits by the template editor. Tests don't probe divergence.

**`bodyKey` silent coercion.** [js/template-schema.js](js/template-schema.js) normalizeSession sets `bodyKey = key || null` when `bodyKey` is undefined. This means a template author who forgets `bodyKey` silently gets a lookup against the session `key`, which coincidentally works because [js/session-bodies.js](js/session-bodies.js) is keyed by the same tokens. Validator error at [js/template-schema.js:324-329](js/template-schema.js#L324-L329) fires only for *explicitly* set unknown bodyKeys.

**Duplicated built-in templates.** [js/session-templates.js](js/session-templates.js) inlines manufacturing and warehousing templates (~600 lines) as two full definitions. The diffs are small (one session's duration 240 vs 180, one missing session, one fewer `training_support_4`), but the structure is copy-pasted — a change to one will silently skip the other. Frozen fixture at [tests/fixtures/template-runtime-parity.js](tests/fixtures/template-runtime-parity.js) locks current contents but does not enforce the diff remains intentional.

**Legacy sentinel migration still live.** `LEGACY_SENTINEL_SUBJECT = "[TP] Project Index"` at [js/m365.js:31](js/m365.js#L31), referenced at [js/m365.js:284](js/m365.js#L284) and [js/m365.js:440](js/m365.js#L440). No git-history comment or sunset date. If no tenants still have a legacy sentinel, this is permanent drag on two Graph code paths.

**Deep link path mirrors project merge in two places.** [js/projects.js:1222](js/projects.js#L1222) `mergeDeepLinkProject` has no importers; `applyDeepLinkProject` in [js/m365.js](js/m365.js) is the live path. Duplicate function, dead branch.

**Sentinel serialization duplicated.** [js/projects.js:1263](js/projects.js#L1263) `serializeSentinelProjects` — no importers; `serializeProjectsForSentinel` in [js/sentinel-model.js](js/sentinel-model.js) is live. Same shape of logic in two modules.

**ENTRA_SETUP.md line anchors wrong.**
- [ENTRA_SETUP.md:107](ENTRA_SETUP.md#L107) — `/c:/_apps/_training_planner/js/config.js:1` — line 1 is `PRODUCT_NAME`, not `GRAPH_CLIENT_ID` or `GRAPH_TENANT_ID`. Anchor should be line 2 and 3/4.
- [ENTRA_SETUP.md:148-149](ENTRA_SETUP.md#L148-L149) — `m365.js:89` lands mid-function, and `m365.js:143` does not correspond to `getAccessToken` (starts at 145).

**`config.example.js` vs `config.js`.** Example file has `GRAPH_TENANT_ID = "YOUR_TENANT_ID_HERE"` ([js/config.example.js:3](js/config.example.js#L3)) — plain. Real file has two lines, a commented-out `"organizations"` and an active `"common"` ([js/config.js:3-4](js/config.js#L3-L4)). The example doesn't teach the user that the tenant choice gates work-vs-personal accounts; the real file hints at it only as inline comments.

---

## 3. Fragility

**`getAccessToken` swallows errors.** [js/m365.js:145](js/m365.js#L145) — on popup dismiss / failure returns `null`. Callers hit a generic `"Could not get a Microsoft Graph access token."` at [js/m365.js:200](js/m365.js#L200). Real root cause (network block, tenant restriction, user cancel, CAE step-up) is lost. Three-CDN fallback at [js/m365.js:21-25](js/m365.js#L21-L25) masks the same thing at the script-load layer.

**Sentinel writes have no CAS.** `writeSentinel` is read-modify-write on an open extension. Two concurrent tabs (or PM + IS simultaneously) can silently overwrite each other. No ETag or change-key check in the code path. No test exists for this (there's nothing to test — the mechanism isn't implemented).

**PATCH→POST open-extension fallback untested.** Open extensions sometimes require POST-then-PATCH semantics; fallback logic in `pushGraphEvent` exists but no test exercises it (tests/m365.test.js covers happy path + rollback, not the fallback branch).

**Push rollback is best-effort.** `pushSessionToCalendar` rollback tested at [tests/m365.test.js](tests/m365.test.js) for the persist-fails case. But: if the Graph POST succeeds and rollback DELETE fails, the event is live on the calendar without a local record. No test covers this; no queueing for retry.

**Day view state bypasses central state.** `dayViewState` module-scoped in [js/dayview.js](js/dayview.js). Any UI element outside the day view modal cannot read the "pendingCommit" flag. If the modal is closed unexpectedly, the flag is lost.

**Focus restoration edge cases.** `updateRenderSlot` in [js/render.js:1332](js/render.js#L1332) captures `document.activeElement` and attempts to restore it, but only for `input/textarea/select`. Focus on a `button`, `[contenteditable]`, or `[tabindex]` element is lost silently — might be intentional.

**Render-shell regeneration.** `ensureRenderShell` at [js/render.js:1349](js/render.js#L1349) re-injects if missing. If a stray external script deletes `#toast`, toast calls `utils.js#toast` will noop until the next render cycle. Not defensive against mid-render shell loss.

**Smart Fill two-pass ordering.** [js/scheduler.js](js/scheduler.js) implements dates-then-times. No test exercises the algorithm — if phase gate constraints and locked anchors interact in an unexpected way, there's no regression net. (Confirmed from [tests/scheduler.test.js](tests/scheduler.test.js) — only window/unschedule tests present.)

**`getSessionBody` silent empty string.** If `bodyKey` points to a deleted entry, [js/session-templates.js:659](js/session-templates.js#L659) and [js/template-schema.js:640](js/template-schema.js#L640) fall through the `||` chain and return empty. No console warning.

**MSAL CDN supply chain.** Three `*.min.js` URLs pinned to version 2.39.0 but NOT to SRI (`integrity=` attribute missing from dynamic script injection at [js/m365.js:56-61](js/m365.js#L56-L61)). Any CDN compromise executes arbitrary code in the app. Also, `alcdn.msauth.net` is Microsoft-controlled, but `unpkg.com` and `cdn.jsdelivr.net` are not; they're fallbacks, so the more-compromised option wins when the more-trusted one is down.

---

## 4. Scope and permission surface

Scopes requested: `Calendars.ReadWrite`, `Calendars.Read.Shared`, `People.Read` ([js/config.js:6](js/config.js#L6)).

**`Calendars.ReadWrite`** — justified. Live usages: event list read, event create/update/delete, open-extension CRUD (sentinel). Many call sites; core to the app.

**`Calendars.Read.Shared`** — justified. Used by reconciliation path to read the other actor's mailbox (`reconcilePmProjects` reads IS events, `reconcileIsProjects` reads PM events). Tested at [tests/m365.test.js](tests/m365.test.js) reconciliation cases.

**`People.Read`** — single live usage: `${getGraphBase()}/people?$search=...` at [js/m365.js:517](js/m365.js#L517). Used by onboarding/settings people search. One call site justifies the scope, but it's a narrow use — worth confirming it's still live in the UI flow.

**Not over-scoped.** No `Mail.Read`, no `User.Read.All`, no `Directory.*`. No app-only permissions.

**Entra doc mismatches.** [ENTRA_SETUP.md:15](ENTRA_SETUP.md#L15) says "delegated Microsoft Graph permissions and the correct SPA redirect URI(s)" — accurate. [ENTRA_SETUP.md:50-52](ENTRA_SETUP.md#L50-L52) says "Implicit grant: Not required for this app" — correct (MSAL 2.x uses auth code + PKCE). Verification checklist at [ENTRA_SETUP.md:133-140](ENTRA_SETUP.md#L133-L140) is grounded.

---

## 5. Test coverage honesty

**Real-behavior tests that earn their keep:**
- [tests/m365.test.js](tests/m365.test.js) (18 cases) — XSS escaping in `buildHandoffBody` / `buildCloseNotificationBody` (explicitly asserts `&lt;script&gt;`); extended-property payload shape for PM vs IS; deep-link seed-not-overwrite; push rollback; sentinel auto-seed refusal on foreign mailbox; reconciliation drift detection + adoption + sparse PM round-trip; refresh_failed and handed_off_pending_is states.
- [tests/projects.test.js](tests/projects.test.js) — isDateWithinPhaseWindow edge cases (same-day cross-phase, internal setup buffer, setup-min expansion); removeSession recompute; deriveProjectStatus lifecycle; projectReadyToClose reconciliation gate; canEditSession post-handoff PM lockout.
- [tests/render.test.js](tests/render.test.js) (8 cases) — focus-preserving updateRenderSlot, template timeline layout clamps (320/180/267/501).
- [tests/sentinel-model.test.js](tests/sentinel-model.test.js) — v1→v2 inflation, v2 round-trip, PM sparse-write drops execution fields.
- [tests/template-schema.test.js](tests/template-schema.test.js) — runtime parity against frozen fixture; `serializeTemplateLibrarySource` round-trip via temp-dir module import.
- [tests/template-editor.test.js](tests/template-editor.test.js) — cross-phase move rejection, inspector, graph render.
- [tests/calendar-sources.test.js](tests/calendar-sources.test.js) (8 cases) — phase-owner mapping, PM/IS fetch plans, 403/404 classification.

**Gaps (real, not nitpicks):**
- **Smart Fill two-pass algorithm** — no test. High-complexity scheduler path with phase gates + locked anchors.
- **pushGraphEvent PATCH→POST fallback** — no test.
- **Concurrent sentinel write / CAS** — no test *because the mechanism doesn't exist*.
- **MSAL token failure modes** — no test coverage of popup dismiss → `null` → generic error collapse.
- **Rollback-fails-after-post** — tested is `persist-fails-after-post`. Not tested is `rollback-delete-fails-after-persist-fails`.
- **Conflicts.js** — [tests/conflicts.test.js](tests/conflicts.test.js) is one test covering calendarSource override. 261 lines of module, 1 test. Most of the branching (`isPastDateTime`, `normalizeEventDate`, `getCalendarConflictsForDate`) is not exercised — and three of those functions are dead anyway (see §6).
- **Deep link** — [tests/deeplink.test.js](tests/deeplink.test.js) is one test (templateSnapshot round-trip). No coverage of oversize payloads (DEEP_LINK_LIMIT enforcement) or malformed input.
- **Shift dialog re-entry** — no test.
- **PM/IS deep-link actor mode mismatch** — no test.

**Trivial-assertion tests I'd flag:** none stood out — every test I read was doing real-behavior work.

---

## 6. Dead code and vestigial structure

Confirmed by grep (no importers anywhere in repo):

- [js/state.js:4](js/state.js#L4) `STORAGE_EXCEPTION_NOTE` — dead export.
- [js/projects.js:991](js/projects.js#L991) `projectIsComplete` — dead.
- [js/projects.js:1222](js/projects.js#L1222) `mergeDeepLinkProject` — dead (superseded by `applyDeepLinkProject` in m365.js).
- [js/projects.js:1263](js/projects.js#L1263) `serializeSentinelProjects` — dead (superseded by `serializeProjectsForSentinel` in sentinel-model.js).
- [js/scheduler.js:1600](js/scheduler.js#L1600) `pushableCount` — dead.
- [js/scheduler.js:1604](js/scheduler.js#L1604) `visibleSessions` — dead.
- [js/scheduler.js:1608](js/scheduler.js#L1608) `getReviewableConflictCount` — dead.
- [js/conflicts.js:199](js/conflicts.js#L199) `getCalendarConflictsForDate` — dead.
- [js/conflicts.js:249](js/conflicts.js#L249) `isPastDateTime` — dead.
- [js/conflicts.js:258](js/conflicts.js#L258) `normalizeEventDate` — dead.

Note: [js/conflicts.js:195](js/conflicts.js#L195) `getConflictedDates` is **live** (used by [js/dayview.js:437](js/dayview.js#L437)).

**Vestigial structure, not dead but suspect:** `LEGACY_SENTINEL_SUBJECT` migration path in [js/m365.js](js/m365.js) — still executed on every sentinel fetch.

**Review gap:** I did not grep [css/](css/) for orphaned selectors. Seven CSS files are loaded unconditionally from [index.html:22-28](index.html#L22-L28); I couldn't verify every selector is still matched by live DOM.

---

## 7. Documentation drift

- [ENTRA_SETUP.md:107](ENTRA_SETUP.md#L107) — wrong line anchor (line 1 is `PRODUCT_NAME`, not `GRAPH_CLIENT_ID` / `GRAPH_TENANT_ID`).
- [ENTRA_SETUP.md:148-149](ENTRA_SETUP.md#L148-L149) — `m365.js:89` lands inside `createMsalInstance`; `m365.js:143` is off-by-two for `getAccessToken` (starts at 145).
- [ENTRA_SETUP.md:140](ENTRA_SETUP.md#L140) — verification checklist mentions "reconcile handed-off IS state through delegated shared-calendar reads where mailbox sharing/delegate access exists" — accurate given scopes, but doesn't tell the setup engineer what to do when sharing *doesn't* exist (the app returns `handed_off_pending_is`, but this isn't documented).
- [js/state.js:4](js/state.js#L4) — comment contradicts MSAL config.
- No `README.md` at repo root (confirmed earlier) — onboarding doc is ENTRA_SETUP.md only.

---

## 8. Dependencies and supply chain

- [package.json](package.json): no dependencies, no devDependencies. `"test": "node --test"` — node:test is the entire harness.
- MSAL loaded at runtime from three CDNs ([js/m365.js:21-25](js/m365.js#L21-L25)) — version 2.39.0. No SRI `integrity=` attribute on injected scripts.
- Google Fonts preconnect + stylesheet at [index.html:19-21](index.html#L19-L21). External render-blocking dependency.
- **`.gitignore` is empty (0 bytes).** Confirmed by `wc -c`.
- **[js/config.js](js/config.js) is tracked in git** with a hardcoded dev client ID `3248df34-1115-45f0-832f-32919ae81b91` and `GRAPH_TENANT_ID = "common"`. Not a secret (client IDs are public), but the committed `"common"` tenant means the deployed config allows personal Outlook.com accounts in prod unless someone remembers to uncomment the `"organizations"` line — a footgun.

---

## 9. Things that look intentional but might not be

- [js/clientplan.js](js/clientplan.js) self-aging IIFE is written in pre-ES6 (var, index-for loops). **Likely intentional** for Outlook webview / ancient clients, but not commented as such.
- `tp-doc-*` namespace in clientplan.js vs `tp-*` in the app. **Likely intentional** isolation, but easy to "clean up" into matching prefixes without realizing it breaks the export.
- Eager commit of template draft to library in [js/template-editor.js](js/template-editor.js) with only export gated by dirty flag — looks like a design compromise, not a bug. Worth confirming.
- `STORAGE_EXCEPTION_NOTE` as an exported string constant rather than a comment — suggests it was planned to be imported/asserted somewhere and never wired up.
- `GRAPH_TENANT_ID = "common"` in [js/config.js:4](js/config.js#L4) active, with `"organizations"` commented out above it. Looks like a dev left dev config committed.
- [js/m365.js:21-25](js/m365.js#L21-L25) three-CDN fallback list — looks defensive but the two non-Microsoft CDNs widen the supply-chain surface.

---

## 10. Open questions

1. Is `People.Read` still exercised in the current UI flow, or does onboarding/settings fall back to manual email entry? If not exercised, the scope could be dropped.
2. Are there tenants still carrying `[TP] Project Index` legacy sentinels? If no, `LEGACY_SENTINEL_SUBJECT` migration at [js/m365.js:284](js/m365.js#L284) and [js/m365.js:440](js/m365.js#L440) can be deleted.
3. Is the manufacturing vs warehousing template divergence intentional (different domains) or accidental drift from a shared root? The frozen-parity test locks current state but doesn't assert intent.
4. Why `cacheLocation: "sessionStorage"` for MSAL if [js/state.js:4](js/state.js#L4) insists application data must not use it? Is MSAL explicitly exempted, or was that note written pre-MSAL integration?
5. Is eager commit of template draft to the library (only serialization is gated by "dirty") the deliberate contract, or should the library be updated only on explicit save?
6. Should dev-config (`"common"` tenant, placeholder client ID) remain in a tracked [js/config.js](js/config.js), or should that file be in `.gitignore` with only `config.example.js` tracked?

---

## Review gaps

- **[js/session-bodies.js](js/session-bodies.js)** — read; static string table, no logic.
- **[css/](css/) (seven files)** — **not audited for orphaned selectors**. No coverage tooling runs against them.
- **styles/ directory** — does not exist; flagged in case earlier memory referenced it.
- **Full app.js wiring** — 1179 lines, read for scope/state flow but not every event handler verified against live DOM.
- **MSAL PATCH→POST fallback** — code branch read; not exercised by any test, so dynamic behavior under 405 responses is unverified.
- **Actual Graph responses under throttling / 429** — no code handling, no test; unverifiable without live tenant.
- **[js/invites.js](js/invites.js)** — referenced via `buildBodyHTML/buildSubject/parseInvitees` imports in m365.js; not opened in this audit. XSS escaping is tested via the m365 body-building tests, so the surface is partially covered.
