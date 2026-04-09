# Audit Report: Training Planner Redesign

**Date:** 2026-04-09
**Scope:** 16 files, +4297 / -4278 lines, single Codex session
**Note:** Implementation agent confirmed no live browser or Graph smoke test was run.
 
## Resolution Tracking

| ID | Severity | File(s) | Finding | Status | Resolution |
|----|----------|---------|---------|--------|------------|
| C1 | Critical | deeplink.js, m365.js, app.js | Deep link payload exceeds 1500 chars | ✅ Fixed | Reduced the deep link payload to `{ v, id }` only and changed IS landing to resolve the full project from the signed-in user's sentinel by project ID. |
| C2 | Critical | session-templates.js | Installation typed internal | ✅ Fixed | Removed `installation` from `INTERNAL_BODY_KEYS` so Installation is now treated as an external attendee-bearing session. |
| C3 | Critical | m365.js | calendarView fetch not paginated | ✅ Fixed | Added `$top=250` to the `calendarView` request and now follow `@odata.nextLink` until all pages are accumulated before returning events. |
| M1 | Major | session-templates.js | Support Handover typed internal | ✅ Fixed | Removed `support_handover` from `INTERNAL_BODY_KEYS` so Support Handover is now classified as external. |
| M2 | Major | app.css | Missing --phase-*-border/text variables | ✅ Fixed | Added the missing phase border/text CSS variables in `:root` and replaced phase-specific border and text styling to use those variables instead of hardcoded literals. |
| M3 | Major | config.js, config.example.js | Missing Calendars.ReadWrite.Shared scope | ✅ Fixed | Added `Calendars.ReadWrite.Shared` to both scope lists and documented that delegate writes require re-consent on the next login. |
| M4 | Major | render.js | Onboarding 5 steps not 7 | ✅ Fixed | Split onboarding into the required 7-step flow with separate Timeline, Invitees, and Location steps and updated the progress/create-step thresholds accordingly. |
| M5 | Major | conflicts.js, render.js, dayview.js, app.css | Window vs calendar conflict indistinguishable | ✅ Fixed | Added conflict-kind summaries and distinct window-vs-calendar styling so outside-window issues render as amber/dashed while calendar overlaps remain red and both kinds stay blocking. |
| m1 | Minor | projects.js | Internal sessions appear pushable | ✅ Fixed | Updated `canCommitSession` to reject `session.type === "internal"` so internal sessions never show push actions or enter push queues. |
| m2 | Minor | m365.js | Misleading variable name nextMonday | ✅ Fixed | Renamed the all-day sentinel end-date variable from `nextMonday` to `endDate` at series creation. |
| m3 | Minor | m365.js | People search filters client-side | ✅ Fixed | Switched `searchPeople` to use a server-side `$search` query on `/me/people` instead of fetching and filtering a larger client-side list. |
| m4 | Minor | m365.js | fetchCalendarEvents duplicates graphRequest | ✅ Fixed | Extended `graphRequest` with `extraHeaders` and refactored `fetchCalendarEvents` to reuse it for timezone-aware calendar reads. |
| m5 | Minor | app.css | Settings grid single column on desktop | ✅ Fixed | Added a two-column desktop grid for `.settings-grid` and kept the single-column layout for smaller screens. |
| m6 | Minor | — | Azure client ID in git history | ⚠️ Manual | Rotate in Azure portal — not a code fix |
| m7 | Minor | m365.js | Sentinel fallback matches non-series events | ✅ Fixed | Tightened `findSentinelSeries` to return only `seriesMaster` matches and removed the loose subject-prefix fallback. |
| — | Critical | m365.js, state.js | OData bracket risk in sentinel subject | ✅ Fixed | Replaced the sentinel subject prefix with `TP-ProjectIndex` everywhere it is defined and used in Graph lookup/create paths. |

---

## Critical — will break in production or violates a hard plan constraint

### C1. Deep link payload exceeds 1500-character limit for Manufacturing/Warehousing projects
**Files:** `js/deeplink.js`, `js/m365.js:756`, `js/state.js:5`

A Manufacturing project with 13 implementation sessions produces ~2010 bytes of JSON. Base64url encoding inflates this to ~2680 characters. The check at `m365.js:756` (`if (length > DEEP_LINK_LIMIT)`) will throw for every Manufacturing and Warehousing project, **completely blocking PM-to-IS handoff** — the core new workflow.

Estimated breakdown for a typical unscheduled Manufacturing project:
- Implementation sessions (13 x ~115 chars each): ~1520 chars
- Project metadata (id, emails, dates, etc.): ~320 chars
- Context summaries: ~150 chars
- Total JSON: ~2010 bytes -> ~2680 base64url chars

If sessions are scheduled (dates/times/graphEventIds populated), the payload grows to ~3500+ chars.

**Recommended fix:** Compress the JSON before encoding (e.g., `CompressionStream('gzip')` then base64url), strip empty/null fields (`dt`, `tm`, `g` when blank), or use shorter IDs in the payload. Alternatively, the sentinel itself could serve as the handoff medium (the delegate-write path already syncs project data), with the deep link carrying only a project ID.

### C2. Installation session typed as internal — spec requires external
**File:** `js/session-templates.js:28`

`INTERNAL_BODY_KEYS` includes `"installation"`, causing all Installation sessions to have `type: "internal"`. The spec explicitly states "Installation 60m (external)". This means:
- Installation sessions pushed to Graph will have **no attendees** (`buildEventPayload` at `m365.js:516` only adds attendees for external sessions)
- No Outlook invite button shown for Installation
- `deriveProjectStatus` counts them as auto-committed (`session.graphActioned || session.type === "internal"`)

Installation is typically a customer-facing environment setup session that needs client attendees.

**Recommended fix:** Remove `"installation"` from `INTERNAL_BODY_KEYS`.

### C3. Calendar event fetch has no pagination — conflict detection unreliable
**File:** `js/m365.js:598-638`

`fetchCalendarEvents` calls Graph's `/calendarView` endpoint without a `$top` parameter and does not follow `@odata.nextLink`. Graph API defaults to **10 items per page**. For a project spanning weeks or months, most calendar events will be missing, causing:
- False "no conflicts" results
- Silent data loss on busy calendars
- The conflict review flow (`runPushWorkflow`) giving false all-clear before pushing

**Recommended fix:** Add `$top=250` to the query parameters and implement a pagination loop following `@odata.nextLink` until all events are retrieved.

---

## Major — incorrect behaviour, missing feature, or plan deviation that affects a phase exit test

### M1. Support Handover typed as internal — spec requires external
**File:** `js/session-templates.js:28`

`INTERNAL_BODY_KEYS` includes `"support_handover"`, but the spec says "Support Handover 15m (external)". Same consequences as C2 — no attendees, no Outlook button, auto-committed.

**Recommended fix:** Remove `"support_handover"` from `INTERNAL_BODY_KEYS`.

### M2. Missing --phase-*-border and --phase-*-text CSS variables
**File:** `styles/app.css`

The plan requires "tint/border/text variants" for each phase. Only tint variants are defined (`--phase-setup-tint`, `--phase-implementation-tint`, `--phase-hypercare-tint`). Phase border colors are hardcoded throughout:
- `app.css:437`: `.dv-session.phase-setup { border-color: rgba(46, 111, 149, 0.24); }`
- `app.css:438`: `.dv-session.phase-implementation { border-color: rgba(187, 122, 18, 0.28); }`
- `app.css:439`: `.dv-session.phase-hypercare { border-color: rgba(77, 143, 100, 0.28); }`

No `--phase-*-text` variables exist. Phase text coloring relies on inherited `--text` or hardcoded values.

**Recommended fix:** Define `--phase-setup-border`, `--phase-setup-text` (and implementation/hypercare equivalents) in `:root` and reference them throughout.

### M3. Delegate write path will fail — scope missing Calendars.ReadWrite.Shared
**Files:** `js/m365.js:766-775`, `js/config.js:4`, `js/config.example.js:4`

`createHandoffEvent` attempts to write to the IS user's calendar at `getGraphBase(resolvedUser.id)/events`. The `Calendars.ReadWrite` scope only grants access to the **signed-in user's** calendar. Writing to another user's calendar requires `Calendars.ReadWrite.Shared` (delegated) or admin-granted application permissions. This path will return 403 for most tenants.

The fallback path (creating the event on PM's own calendar as an invite) is correctly implemented and reachable, so handoff won't be fully blocked — but the delegate-write path is dead code without the scope change.

**Recommended fix:** Add `Calendars.ReadWrite.Shared` to `GRAPH_SCOPES` in both `config.js` and `config.example.js`, or document that delegate access requires tenant admin configuration.

### M4. Onboarding flow has 5 steps, plan specifies 7
**File:** `js/render.js:284`

Plan specifies: client -> team -> timeline -> invitees -> location -> sessions -> confirm (7 steps). Implementation has: Client -> Team -> Timeline -> Sessions -> Confirm (5 steps). Invitees and Location are merged into the Timeline step (step 2), which now has 5 input fields including a textarea. This is a plan deviation and crowds the Timeline step on mobile.

**Recommended fix:** Split step 2 into three steps (Timeline with dates/hypercare, Invitees with email textarea, Location) and adjust the step labels and `nextOnboardingStep` cap accordingly.

### M5. Window-violation conflicts not visually distinguishable from calendar overlap conflicts
**Files:** `js/conflicts.js:40-49`, `styles/app.css:440-441`

`buildWindowConflict` sets `kind: "window"` on synthetic conflicts, but the rendering (`render.js` badge counts, `dayview.js` session blocks) applies the same `conflict` CSS class and danger styling for both types. Users cannot tell whether a flagged session overlaps a real calendar event or simply falls outside its phase window.

**Recommended fix:** Add a distinct visual treatment (e.g., dashed border or different color) for `kind: "window"` conflicts, and show the conflict kind in the conflict badge text.

---

## Minor — code quality, edge cases, or UX gaps to fix before the next session

### m1. Internal sessions included in getPushableSessions
**File:** `js/projects.js:364-368`

`canCommitSession` checks owner, not type. Internal sessions (Sales Handover, PM Handover, Imp. Handover) will appear as pushable and get "Push" buttons. While `deriveProjectStatus` already treats them as auto-committed (`session.graphActioned || session.type === "internal"`), users may be confused by push buttons on internal sessions.

**Recommended fix:** Add `&& session.type !== "internal"` to the filter in `getPushableSessions`, or hide the push button for internal sessions in `render.js:191`.

### m2. createSentinelSeries misleading variable name
**File:** `js/m365.js:273`

`nextMonday` is set to `monday + 1 day` (Tuesday). It's the correct end date for a single-day all-day event, but the variable name is misleading.

**Recommended fix:** Rename to `endDate` or `dayAfterStart`.

### m3. People search fetches all then filters client-side
**File:** `js/m365.js:460-478`

`searchPeople` fetches `/me/people?$top=50` then filters locally. The People API supports `$search` for server-side filtering, which would be more accurate for large organizations. Current approach may miss relevant matches.

**Recommended fix:** Use `$search="${query}"` on the People API request.

### m4. fetchCalendarEvents duplicates auth/timeout logic instead of using graphRequest
**File:** `js/m365.js:585-638`

This function manually gets a token, creates a fetch with timeout, and parses the response — duplicating the pattern already in `graphRequest`. The `Prefer: outlook.timezone` header is the only addition.

**Recommended fix:** Extend `graphRequest` to accept extra headers, then use it here.

### m5. Settings grid has no multi-column layout on desktop
**File:** `styles/app.css:255`

`.settings-grid` gets `display: grid; gap: 0.8rem` but no `grid-template-columns`. All fields stack in a single column even on wide screens.

**Recommended fix:** Add `grid-template-columns: repeat(2, 1fr)` for `.settings-grid` at desktop widths.

### m6. Git history still contains the Azure client ID
**Files:** `js/config.js` (staged deletion), `.gitignore`

The staged `D js/config.js` will remove the file from tracking on next commit, and `.gitignore` will prevent re-addition. However, the client ID `3248df34-1115-45f0-832f-32919ae81b91` remains in git history and must be rotated in Azure AD.

**Recommended fix:** Rotate the client ID in Azure portal after committing the deletion. Optionally use `git filter-branch` or BFG to purge history, though rotation is the priority.

### m7. findSentinelSeries fallback may match non-series events
**File:** `js/m365.js:265-268`

The second fallback `events.find(e => e.subject?.startsWith(SENTINEL_SUBJECT))` could match a manually created event with the same subject prefix. Unlikely but possible.

**Recommended fix:** Remove the second fallback, or tighten it to also check `e.type === "singleInstance"` and treat it as a migration case.

---

## Confirmed — verified as correctly implemented

| Dimension | Item | Status |
|-----------|------|--------|
| 1. Preflight | `js/config.js` untracked and in `.gitignore` | Confirmed |
| 1. Preflight | `config.example.js` documents PRODUCT_NAME, CLIENT_ID, TENANT_ID, SCOPES | Confirmed |
| 1. Preflight | `--phase-pm`, `--phase-is`, `--phase-setup`, `--phase-implementation`, `--phase-hypercare` + tint variants defined as CSS variables | Confirmed |
| 1. Preflight | MSAL authority uses `"organizations"` not `"common"` (`config.js:3`) | Confirmed |
| 1. Preflight | `People.Read` in scope set (`config.js:4`, `config.example.js:4`) | Confirmed |
| 2. State | State shape has `projects`, `activeProjectId`, `actor`, `mode`, `sentinel`, `ui` (`state.js:40-81`) | Confirmed |
| 2. State | Adapter selectors: `getAllSessions`, `getPhaseSessions`, `findSession`, `getEditableSessions`, `getPushableSessions`, `getSchedulableSessions` in `projects.js` | Confirmed |
| 2. State | No app reads/writes to localStorage/sessionStorage (only MSAL cache) | Confirmed |
| 2. State | MSAL cache set to `sessionStorage` (`m365.js:91`) | Confirmed |
| 3. Sentinel | `fetchSentinel`, `writeSentinel`, `ensureSentinelSeries`, `resolveUserByEmail`, `createHandoffEvent` all implemented in `m365.js` | Confirmed |
| 3. Sentinel | Recurring Monday all-day free series with weekly recurrence (`m365.js:271-306`) | Confirmed |
| 3. Sentinel | Open extension on series master, not individual occurrences (`readSentinelExtension`/`writeSentinelExtension` operate on `masterId`) | Confirmed |
| 3. Sentinel | Recoverable bootstrap error: user sees error + "Reset Sentinel" button, not auto-reset (`render.js:88-94`, `m365.js:392-404`) | Confirmed |
| 3. Sentinel | `findSentinelSeries` prioritizes `event.type === "seriesMaster"` (`m365.js:265`) | Confirmed |
| 4. Onboarding | Auth gate -> project list -> onboarding flow correct (`state.ui.screen` transitions) | Confirmed |
| 4. Onboarding | IS picker with People.Read search + manual email fallback (render.js step 1) | Confirmed |
| 4. Onboarding | Clean empty state with "No projects yet" card (`render.js:98`) | Confirmed |
| 5. Templates | Manufacturing, Warehousing, Custom templates present (`session-templates.js:107-111`) | Confirmed |
| 5. Templates | Each session carries `phase`, `owner`, `type`, stable `key` | Confirmed |
| 5. Templates | Manufacturing session list matches spec (names, durations, phases, owners, order) **except** Installation and Support Handover `type` (see C2, M1) | Confirmed with exceptions |
| 5. Templates | Warehousing: BOM 30m (not 60m), no Manufacturing session, 3 Training Supports (not 4) | Confirmed |
| 5. Templates | Go-Live treated as PM-owned anchor at `goLiveDate` (`session-templates.js:113-121`) | Confirmed |
| 6. Workspace | Old flat sidebar/form markup completely removed; `index.html` is minimal shell | Confirmed |
| 6. Workspace | Session list groups by phase with coloured vertical bars (`render.js:205-216`, `app.css:214-216, 234-244`) | Confirmed |
| 6. Workspace | Phase headers: name, owner, date range, scheduled count (`render.js:209-213`) | Confirmed |
| 6. Workspace | Internal sessions suppress Outlook invite button (`render.js:192`) | Confirmed |
| 6. Workspace | Project metadata editing in settings modal (`render.js:288-292`) | Confirmed |
| 6. Workspace | `invites.js` and `m365.js` fully decoupled from `globalClient`, `globalOrganiser`, `globalEmail`, `globalInvitees`, `globalLocation` | Confirmed |
| 7. Deep link | `deeplink.js` has URL-safe base64 encode/decode (`toBase64Url`/`fromBase64Url`) | Confirmed |
| 7. Deep link | Payload includes project identity, PM/IS identities, implementation window, sessions, context summaries | Confirmed |
| 7. Deep link | App detects `?project=` on load and skips to IS mode (`app.js:466-475`) | Confirmed |
| 7. Deep link | Both delegate-write path and fallback invite path exist; fallback reachable (`m365.js:765-782`) | Confirmed |
| 7. Deep link | IS mode: Implementation editable, Setup/Hypercare read-only context (`projects.js:352-358`, `render.js:219-230`) | Confirmed |
| 8. Phase windows | Setup < implementationStart, Implementation in [implementationStart, goLiveDate-1], Hypercare in [goLiveDate, goLiveDate+weeks] (`projects.js:304-329`) | Confirmed |
| 8. Phase windows | Smart Fill respects phase windows via `nextValidDate` -> `isDateWithinPhaseWindow` (`scheduler.js:73-89`) | Confirmed |
| 8. Phase windows | Drag/drop guards enforce windows via `setSessionDate` -> `isDateWithinPhaseWindow` (`scheduler.js:334`) | Confirmed |
| 9. Push split | PM Push All excludes IS-owned sessions (`canCommitSession` checks `session.owner === "pm"`) | Confirmed |
| 9. Push split | IS Commit excludes PM-owned sessions (`canCommitSession` checks `session.owner === "is"`) | Confirmed |
| 9. Push split | Handoff gate: `readyForHandoff` requires all Implementation sessions scheduled (`scheduler.js:502-504`) | Confirmed |
| 9. Push split | IS commit updates PM sentinel via `syncProjectToPartnerSentinel(project, "pm")` (`m365.js:661`) | Confirmed |
| 9. Push split | Status transitions (`scheduling` -> `pending_is_commit` -> `active` -> `complete`) derive from project metadata, not UI state (`projects.js:417-443`) | Confirmed |
| 10. Risks | Old client ID not in currently tracked files (staged deletion + `.gitignore`) | Confirmed (history rotation needed) |

---

## Sentinel extension code paths to flag for live testing (Dimension 10)

| Code path | File:Line | Risk |
|-----------|-----------|------|
| `readSentinelExtension` | `m365.js:308` | GET on open extension by name — 404 handling present but extension name format untested |
| `writeSentinelExtension` PATCH | `m365.js:319-326` | PATCH on existing extension — payload structure may not match Graph's expectations |
| `writeSentinelExtension` POST fallback | `m365.js:329-333` | POST to create new extension — `@odata.type` field may cause validation errors |
| `fetchSentinel` initial write | `m365.js:361` | Writes empty array to new extension on first use |
| `writeProjectToUserSentinel` | `m365.js:725-735` | Cross-user sentinel read+write — requires delegate or app permissions not in current scopes |
| `syncProjectToPartnerSentinel` | `m365.js:737-749` | Calls `writeProjectToUserSentinel` with partner email — will likely fail, but failure is caught and sets `pendingPmSync` flag |
| `findSentinelSeries` filter | `m365.js:258-259` | OData `startswith` filter with `[TP]` in subject — brackets may cause parsing issues on some Graph implementations |
