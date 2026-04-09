# Audit Report: Training Planner

---

## Redesign Audit Resolution Tracking

| ID | Severity | File(s) | Finding | Status | Resolution |
|----|----------|---------|---------|--------|------------|
| C1 | Critical | deeplink.js, m365.js, app.js | Deep link payload exceeds 1500 chars | ✅ Fixed | Reduced the deep link payload to `{ v, id }` only and changed IS landing to resolve the full project from the signed-in user's sentinel by project ID. |
| C2 | Critical | session-templates.js | Installation typed internal | ✅ Fixed | Removed `installation` from `INTERNAL_BODY_KEYS` so Installation is now treated as an external attendee-bearing session. |
| C3 | Critical | m365.js | calendarView fetch not paginated | ✅ Fixed | Pagination with `$top=250` and `@odata.nextLink` was added in `m365.js`, and this was resolved during the Smart Fill session. |
| M1 | Major | session-templates.js | Support Handover typed internal | ✅ Fixed | Removed `support_handover` from `INTERNAL_BODY_KEYS` so Support Handover is now classified as external. |
| M2 | Major | app.css | Missing --phase-*-border/text variables | ✅ Fixed | All six phase border/text CSS variables were added in `app.css`, and this was resolved during the Smart Fill session. |
| M3 | Major | config.js, config.example.js | Missing Calendars.ReadWrite.Shared scope | ✅ Fixed | Added `Calendars.ReadWrite.Shared` to both scope lists and documented that delegate writes require re-consent on the next login. |
| M4 | Major | render.js | Onboarding 5 steps not 7 | ✅ Fixed | The onboarding flow now matches the 7-step spec in `render.js`, and this was resolved during the Smart Fill session. |
| M5 | Major | conflicts.js, render.js, dayview.js, app.css | Window vs calendar conflict indistinguishable | ✅ Fixed | Conflict treatments are now split into red/solid, amber/dashed, and blue/slate states, and this was resolved during the Smart Fill session. |
| m1 | Minor | projects.js | Internal sessions appear pushable | ✅ Fixed | `canCommitSession` now excludes internal sessions in `projects.js`, and this was resolved during the Smart Fill session. |
| m2 | Minor | m365.js | Misleading variable name nextMonday | ✅ Fixed | Renamed the all-day sentinel end-date variable from `nextMonday` to `endDate` at series creation. |
| m3 | Minor | m365.js | People search filters client-side | ✅ Fixed | Switched `searchPeople` to use a server-side `$search` query on `/me/people` instead of fetching and filtering a larger client-side list. |
| m4 | Minor | m365.js | fetchCalendarEvents duplicates graphRequest | ✅ Fixed | `fetchCalendarEvents` now routes through `graphRequest` with `extraHeaders`, and this was resolved during the Smart Fill session. |
| m5 | Minor | app.css | Settings grid single column on desktop | ✅ Fixed | The desktop settings grid now uses `repeat(2, 1fr)` in `app.css`, and this was resolved during the Smart Fill session. |
| m6 | Minor | - | Azure client ID in git history | ⚠️ Manual | Rotate in Azure portal - not a code fix. |
| m7 | Minor | m365.js | Sentinel fallback matches non-series events | ✅ Fixed | Tightened `findSentinelSeries` to return only `seriesMaster` matches and removed the loose subject-prefix fallback. |
| - | Critical | m365.js, state.js | OData bracket risk in sentinel subject | ✅ Fixed | Replaced the sentinel subject prefix with `TP-ProjectIndex` everywhere it is defined and used in Graph lookup/create paths. |

---

## Smart Fill Audit - 2026-04-09

**Scope:** Smart Fill Two-Pass Rebuild across 10 files (+852 / -119 lines), single Codex session.
**Note:** No browser or live Graph smoke test was run.

---

### Critical - breaks core Smart Fill functionality or violates a hard spec constraint

No critical Smart Fill issues found. The two-pass architecture, date distribution logic, time slot assignment, conflict pipeline, and UI controls are all correctly implemented against the spec.

---

### Major - incorrect behaviour, missing feature, or spec deviation affecting a test plan item

#### SF-M1. `getTimedIntervalsForDate` uses actor-filtered sessions - IS Pass 2 may double-book over unpushed PM sessions
| | |
|---|---|
| **Status** | ✅ Fixed |
| **File** | `js/scheduler.js:344` |
| **Function** | `getTimedIntervalsForDate` |
| **Resolution** | The occupied-interval scan now uses `getAllSessions(project)` so every timed planner session blocks Smart Fill slot assignment regardless of owner. |

The occupied-interval builder called `getEditableSessions(project, actor)` to find already-timed planner sessions on a given date. For PM (`actor = "pm"`), `canEditSession` returns true for all sessions, so all timed sessions were captured. For IS (`actor = "is"`), `canEditSession` only returns true for implementation sessions, so PM-timed setup/hypercare sessions on the same date were excluded from the occupied intervals.

If the PM had timed sessions on a date that falls within the implementation window (for example, a setup session near the boundary) but had not pushed them to Graph yet, the IS Smart Fill could assign an overlapping time slot. Calendar events from Graph catch pushed sessions, but unpushed ones created a gap.

**Practical risk:** Low - phases typically do not share date ranges. But the fix is simple.

**Recommended fix:** Replace `getEditableSessions(project, actor)` with `getAllSessions(project)` in the session-scan loop. The calendar-event and pending-assignment loops are already actor-agnostic.

---

#### SF-M2. Deep link handling regressed - `handleDeepLinkIfPresent` now requires project in sentinel
| | |
|---|---|
| **Status** | ✅ Fixed |
| **File** | `js/app.js:84-97` |
| **Function** | `handleDeepLinkIfPresent` |
| **Resolution** | Deep-link landing now applies embedded payload data with `applyDeepLinkProject` first and falls back to sentinel ID lookup only when that payload cannot be used. |

The previous implementation called `applyDeepLinkProject(state.deepLink.payload)` which decoded the deep link payload and created or merged the project into the IS local state and sentinel. The regressed implementation called `openProject(state.deepLink.payload.id, ...)` which only looked up the project by ID in the existing sentinel.

If the delegate-write path in `createHandoffEvent` fails, the project will not exist in the IS sentinel and the deep link will show an error. The deep link payload data must therefore be honoured on landing instead of being ignored.

**Recommended fix:** Use `applyDeepLinkProject` as the primary deep-link handler and keep sentinel ID lookup only as a fallback path when the payload is absent or cannot be applied.

---

#### SF-M3. `SENTINEL_SUBJECT` changed - breaks existing sentinel series
| | |
|---|---|
| **Status** | ✅ Fixed |
| **File** | `js/state.js:2`, `js/m365.js` |
| **Resolution** | Sentinel discovery now checks both `TP-ProjectIndex` and legacy `[TP] Project Index`, and legacy series are renamed to the new subject on the next write. |

The sentinel subject was changed from `"[TP] Project Index"` to `"TP-ProjectIndex"`. The `findSentinelSeries` function in `m365.js` filtered events using `startswith(subject,'...')`. Existing sentinel series created with the old subject would not be found, causing the app to create a new empty sentinel and lose all existing project data.

**Recommended fix:** Keep the new subject but add a migration path that checks for both old and new subjects in `findSentinelSeries` and renames the old series on write.

---

### Minor - edge cases, UX gaps, or code quality issues to fix before next session

#### SF-m1. Unnecessary sentinel persist when Smart Fill places zero sessions
| | |
|---|---|
| **Status** | ✅ Fixed |
| **File** | `js/app.js:288-294`, `js/scheduler.js:857-858` |
| **Resolution** | The Smart Fill action now skips the sentinel write when no dates, times, or availability conflicts were created and shows a no-op toast instead. |

When `applySmartFill()` returned a result object with all counts at zero, the app layer still called `persistAndRender(true)`, triggering an unnecessary sentinel write. The function skipped `touchProject()` in that case, so the project was not marked as updated, but the write still occurred.

**Recommended fix:** Check the result in `app.js` before persisting and return early when nothing was placed.

#### SF-m2. `setSessionTime("")` does not clear `availabilityConflict` - stale flag on blank time
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/scheduler.js:712-715` |

`setSessionTime` only clears `availabilityConflict` when `value` is truthy. If a session has `availabilityConflict = true` (from Smart Fill) and the user explicitly selects "Time needed" (blank) from the dropdown, the flag stays true. The conflict pipeline still shows an availability conflict for this session, which is technically correct (no time assigned), but the flag was set by Smart Fill, not by the user's deliberate choice.

This is a very minor UX inconsistency - the user set blank time on purpose, yet the "No free time" conflict persists.

**Recommended fix:** No change required for correctness. Optionally, clear the flag on any `setSessionTime` call regardless of value, since the user is now manually managing the time.

#### SF-m3. Calendar chip "needs-time" style applied to ALL untimed sessions, not just availability-conflicted ones
| | |
|---|---|
| **Status** | ✅ Fixed |
| **File** | `js/render.js:328` |
| **Resolution** | The `needs-time` chip styling now applies only when a session is untimed and `availabilityConflict === true`. |

The calendar grid chip added `needs-time` class when `!s.time`. This gave a dashed blue treatment to all untimed sessions, regardless of whether they had an availability conflict. A date-only session without availability conflict, for example just placed by Pass 1 with Pass 2 pending, got the same visual as one that failed Pass 2.

**Recommended fix:** Add the `needs-time` class only when `s.availabilityConflict` is true, or use a neutral dashed style for "awaiting time" and the blue/slate style specifically for "no free time found".

#### SF-m4. Smart Fill toast truncates for large unplaced session counts
| | |
|---|---|
| **Status** | ✅ Fixed |
| **File** | `js/app.js` |
| **Resolution** | Smart Fill toast copy now uses a concise summary builder that reports scheduled, review-needed, and unplaced counts without truncating on larger results. |

The Smart Fill result handler previously built a segmented toast string that did not summarise the "nothing placed" and "many unplaced" cases cleanly.

**Recommended fix:** Summarise the result in one concise sentence, for example `18 sessions scheduled, 4 unplaced - phase window may be too tight.`

#### SF-m5. `dayViewSlotFromEvent` Y-offset hardcoded as 96 instead of using constants
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/app.js:133` |

The drag-drop position calculation uses a magic number `96` (`HEADER_HEIGHT` 32 + `UNTIMED_STRIP_HEIGHT` 64). If either constant changes in `dayview.js`, this value will fall out of sync since it is in a different file.

**Recommended fix:** Export `HEADER_HEIGHT` and `UNTIMED_STRIP_HEIGHT` from `dayview.js` and use them in `app.js`, or move the slot-from-event calculation into `dayview.js`.

---

### Confirmed - verified as correctly implemented

| Dim | Item | File(s) | Status |
|-----|------|---------|--------|
| 1 | `project.smartFillPreference` persisted with "am"/"none"/"pm", default "none" | `projects.js:84-87,148` | Confirmed |
| 1 | `session.availabilityConflict` boolean, default false | `projects.js:112` | Confirmed |
| 1 | `state.ui.smartPreference` ephemeral per-run override | `state.js:77` | Confirmed |
| 1 | `state.calendarAvailability` with status, projectId, rangeStart, rangeEnd, loadedAt, error | `state.js:89-96` | Confirmed |
| 1 | `state.ui.windowChangeDialog` with open, nextProject, affectedSessionIds, affectedCount | `state.js:23-30,81` | Confirmed |
| 1 | `getConflictReviewSessions(project, actor)` includes dated sessions with blank time, excludes internal | `projects.js:374-382` | Confirmed |
| 2 | Pass 1 skips sessions that already have a date | `scheduler.js:810-812` | Confirmed |
| 2 | Pass 1 respects template/session order within each phase via `compareSessions` | `scheduler.js:131-136,812` | Confirmed |
| 2 | Eligible dates filtered: >= today, >= smartStart, inside phase window, day-of-week in activeDays | `scheduler.js:153-175` | Confirmed |
| 2 | Setup/Hypercare: one-per-day first, second-per-day fallback, unplaced reported | `scheduler.js:208-228,240-244` | Confirmed |
| 2 | Implementation: Mon-Sun weeks, base cap 2, promotion to 3 when needed, earliest weeks first | `scheduler.js:191-276` | Confirmed |
| 2 | Within each week: one per date first, second-session fallback within cap | `scheduler.js:208-228` | Confirmed |
| 2 | Weekly hard cap never exceeds 3 | `scheduler.js:43,251` | Confirmed |
| 2 | `applySmartFill()` returns structured result with all 8 specced fields | `scheduler.js:799-808` | Confirmed |
| 2 | Unplaced sessions left untouched and reported | `scheduler.js:822-826` | Confirmed |
| 3 | Pass 2 gated on `calendarAvailability.status === "ready"`, projectId match, range coverage | `scheduler.js:305-326,829-832` | Confirmed |
| 3 | Pass 2 skipped sets `pass2Skipped` and `pass2SkipReason`; no flags mutated | `scheduler.js:830-832` | Confirmed |
| 3 | Working hours 08:30-17:00, 30-min increments, 12:00 boundary | `scheduler.js:38-41` | Confirmed |
| 3 | Preference order: "am"/"none" = morning then afternoon; "pm" = afternoon then morning | `scheduler.js:366-376` | Confirmed |
| 3 | Morning ending <= 12:00; afternoon starting >= 12:00 ending <= 17:00 | `scheduler.js:378-379` | Confirmed |
| 3 | Occupied intervals include M365 events, already-timed sessions, same-run pending assignments | `scheduler.js:332-364` | Confirmed (with SF-M1 caveat for IS actor) |
| 3 | Slot found: time assigned, `availabilityConflict` cleared | `scheduler.js:843-846` | Confirmed |
| 3 | No slot found: date kept, time blank, `availabilityConflict = true` | `scheduler.js:849` | Confirmed |
| 3 | Pass 2 processes ALL date-only sessions, not just current-run dated ones | `scheduler.js:835-837` | Confirmed |
| 4 | `setSessionTime()` clears `availabilityConflict` when non-blank time set | `scheduler.js:713-715` | Confirmed |
| 4 | `setSessionDate()` clears `availabilityConflict` when date removed | `scheduler.js:687-688` | Confirmed |
| 4 | `unscheduleSession()` clears `availabilityConflict` | `scheduler.js:743` via `clearSessionScheduling` | Confirmed |
| 4 | Pass 2 clears `availabilityConflict` on successful slot assignment | `scheduler.js:844` | Confirmed |
| 4 | No path leaves `availabilityConflict = true` after time is successfully assigned | All mutation paths | Confirmed |
| 5 | `kind: "availability"` added to conflict pipeline | `conflicts.js:53-61` | Confirmed |
| 5 | Early-exit relaxed: date-only sessions get window + availability checks | `conflicts.js:98-121` | Confirmed |
| 5 | Evaluation: no date = skip; date + outside window = window; date + blank time + flag = availability; date + time = calendar overlap | `conflicts.js:98-121` | Confirmed |
| 5 | `summarizeConflictKinds()` returns hasWindow/hasCalendar/hasAvailability with correct labels | `conflicts.js:63-91` | Confirmed |
| 5 | Conflict review queue uses `getConflictReviewSessions` via `scope: "review"` | `conflicts.js:35`, `dayview.js:65` | Confirmed |
| 5 | Push/commit queue unchanged - still `getPushableSessions`, requiring date + time | `projects.js:384-388` | Confirmed |
| 6 | Three distinct conflict treatments: red/solid (calendar), amber/dashed (window), blue/slate (availability) | `app.css:591-608` | Confirmed |
| 6 | Existing red/amber semantics unchanged | `app.css:403-404,591-598` | Confirmed |
| 6 | `render.js` shows all conflict kinds per session badge via `renderConflictTags` | `render.js:136-145,215-227` | Confirmed |
| 6 | Toolbar summary includes availability counts | `render.js:130,296`, `conflicts.js:165-199` | Confirmed |
| 6 | Third calendar cell marker for availability conflicts | `render.js:321,328`, `app.css:405` | Confirmed |
| 6 | Day view: timed blocks for timed sessions only, untimed strip beneath headers | `dayview.js:159-196,280-311` | Confirmed |
| 6 | Availability-conflicted sessions in untimed strip with blue/slate treatment | `dayview.js:241-263`, `app.css:600-604` | Confirmed |
| 6 | Blank-time sessions render as "Time needed" in session rows, calendar chips, and day view | `render.js:34-36,252,328`, `dayview.js:261` | Confirmed |
| 7 | Smart Fill panel: start date, day chips/presets, AM/None/PM toggle, Refresh Availability, status line | `render.js:178-211` | Confirmed |
| 7 | Status line: "loaded" when ready, "dates only" otherwise, "refreshing" during load | `render.js:150-155` | Confirmed |
| 7 | `state.ui.smartPreference` initialised from `project.smartFillPreference` on project open | `scheduler.js:88-90,532,539` | Confirmed |
| 7 | `setSmartPreference` and `refreshSmartAvailability` wired in `app.js` | `app.js:262-286` | Confirmed |
| 7 | `getTimeOptionsHTML()` has blank "Time needed" option | `utils.js:78-86` | Confirmed |
| 7 | AM/PM preference in onboarding Timeline step | `render.js:349` | Confirmed |
| 7 | AM/PM preference in project settings modal | `render.js:365` | Confirmed |
| 7 | Smart Fill panel toggle updates `state.ui.smartPreference` only, not `project.smartFillPreference` | `scheduler.js:771-773` | Confirmed |
| 8 | Window check only on settings save, not on every field change | `scheduler.js:616-643` | Confirmed |
| 8 | Check scoped to `implementationStart` and `goLiveDate` only, not `hypercareDuration` | `scheduler.js:625-626` | Confirmed |
| 8 | Tentative project built and compared before saving | `scheduler.js:621-627` | Confirmed |
| 8 | No sessions affected: saves normally without dialog | `scheduler.js:638-642` | Confirmed |
| 8 | Sessions affected: opens dialog without saving first | `scheduler.js:629-635` | Confirmed |
| 8 | Dialog text matches spec: "N sessions fall outside the updated window..." | `render.js:371` | Confirmed |
| 8 | "Clear affected dates" path: clears dates, opens Smart Fill, shows toast | `scheduler.js:645-658`, `app.js:210-218` | Confirmed |
| 8 | "Keep and review" path: saves without clearing, opens conflict review | `scheduler.js:661-666`, `app.js:220-230` | Confirmed |
| 9 | `applySmartFill()` returns full structured result object | `scheduler.js:799-808` | Confirmed |
| 9 | Toast uses result object: surfaces unplaced count, availability count, pass2-skipped reason | `app.js:288-312` | Confirmed |
| 9 | Clear warning when unplaced sessions exist | `app.js:305-306` | Confirmed |
| 9 | Toast when Pass 2 skipped with reason | `app.js:308-309` | Confirmed |
| 9 | Success toast includes meaningful summary | `app.js:311` | Confirmed |
| 10 | Manual scheduling (drag/drop, date/time inputs) works independently of Smart Fill | `scheduler.js:668-698,700-719,866-868`, `app.js:504-533` | Confirmed |
| 10 | Push queue correctly excludes blank-time sessions | `projects.js:384-388` | Confirmed |
| 10 | No render paths fall back to 09:00 for blank-time sessions | `render.js:34-36,252,328`, `dayview.js:168,261` | Confirmed |
| 10 | `fetchCalendarEvents` writes `state.calendarAvailability` metadata on load, ready, and error | `m365.js:601-657` | Confirmed |
| 10 | Pagination added to `fetchCalendarEvents` with `$top=250` and `@odata.nextLink` loop | `m365.js:609-626` | Confirmed |
| 10 | `fetchCalendarEvents` uses `graphRequest` with `extraHeaders` (no more duplicate fetch logic) | `m365.js:619-623` | Confirmed |
| 10 | `canCommitSession` now excludes internal sessions (`session.type === "internal"`) | `projects.js:355-359` | Confirmed |
| 10 | Onboarding flow expanded to 7 steps: Client, Team, Timeline, Invitees, Location, Sessions, Confirm | `render.js:358` | Confirmed |
| 10 | Phase CSS variables now include `--phase-*-border` and `--phase-*-text` variants | `app.css:17-26` | Confirmed |
| 10 | Settings grid has 2-column layout on desktop | `app.css:368` | Confirmed |

---

### Additional regressions found outside Smart Fill scope

These changes were made in the same Codex session but are not part of the Smart Fill spec. They are included here because they affect production correctness.

#### REG-1. Deep link handling changed from payload-based to ID-based lookup
| | |
|---|---|
| **Status** | ✅ Fixed |
| **File** | `js/app.js:84-97` |
| **Resolution** | IS deep-link landing now honours embedded payload data via `applyDeepLinkProject`, with sentinel lookup retained only as a fallback path. |

See SF-M2 above. The `applyDeepLinkProject` function is now called again for payload-backed handoffs, while sentinel lookup is only used when embedded project data is absent or cannot be applied.

#### REG-2. Sentinel subject changed from `[TP] Project Index` to `TP-ProjectIndex`
| | |
|---|---|
| **Status** | ✅ Fixed |
| **File** | `js/state.js:2`, `js/m365.js` |
| **Resolution** | Legacy `[TP] Project Index` sentinel series are now detected and migrated in place instead of being bypassed by the new subject prefix. |

The `findSentinelSeries` lookup now recognises both subject variants so existing data is not orphaned, and the legacy series is renamed on the next write.

#### NEW-1. Restoring payload-based deep links reopens the encoded length limit
| | |
|---|---|
| **Status** | ⚠️ New Finding |
| **File** | `js/deeplink.js`, `js/m365.js` |
| **Resolution** | Not fixed in this pass; the restored payload-based deep links currently encode to 1640 chars for Manufacturing and 1544 for Warehousing in a representative local check, which exceeds the 1500-character limit. |

The deep-link handling fix restored the payload-based handoff path, but the encoded URL is now over the previous hard limit for at least the standard Manufacturing and Warehousing templates.

#### REG-3. Previous audit findings also addressed in this session
The following items from the previous (redesign) audit appear to have been fixed in the same Codex session. They are noted here for tracking:

| Previous Finding | Resolution | Status |
|---|---|---|
| C3. Calendar fetch no pagination | `$top=250` and an `@odata.nextLink` loop were added in `m365.js`, and this was resolved during the Smart Fill session. | ✅ Fixed |
| M2. Missing `--phase-*-border`, `--phase-*-text` CSS variables | All six phase border/text variables were added in `app.css`, and this was resolved during the Smart Fill session. | ✅ Fixed |
| M4. Onboarding 5 steps instead of 7 | The onboarding flow now matches the 7-step spec in `render.js`, and this was resolved during the Smart Fill session. | ✅ Fixed |
| M5. Window conflicts not visually distinct from calendar conflicts | Conflict treatments are now split into red/solid, amber/dashed, and blue/slate states, and this was resolved during the Smart Fill session. | ✅ Fixed |
| m1. Internal sessions in `getPushableSessions` | `canCommitSession` now excludes internal sessions in `projects.js`, and this was resolved during the Smart Fill session. | ✅ Fixed |
| m4. `fetchCalendarEvents` duplicated auth/timeout logic | `fetchCalendarEvents` now routes through `graphRequest` with `extraHeaders`, and this was resolved during the Smart Fill session. | ✅ Fixed |
| m5. Settings grid single-column on desktop | The desktop settings grid now uses `repeat(2, 1fr)` in `app.css`, and this was resolved during the Smart Fill session. | ✅ Fixed |
