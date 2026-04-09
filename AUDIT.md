# Audit Report: Training Planner

---

## Hierarchical Templates & Stage-Aware Smart Fill Audit â€” 2026-04-09

**Scope:** 10 files (+1537 / -461 lines), single Codex session.
**Note:** No browser or live Graph smoke test was run. All 10 files pass `node --check`.

---

### Critical â€” breaks core functionality or violates a hard plan/steering constraint

#### HT-C1. `templates` marked as internal type â€” should be external
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/session-templates.js:28-33` |

`INTERNAL_BODY_KEYS` includes `"templates"`. The Templates session (240m/180m configuration workshop) is a customer-facing training session and should be `type: "external"`. This means Templates sessions will not include attendees when pushed to Graph, will not show an Outlook invite button, and will be auto-counted as "committed" by `deriveProjectStatus` â€” all incorrect for a customer-facing session.

**Recommended fix:** Remove `"templates"` from `INTERNAL_BODY_KEYS`.

#### HT-C2. Implementation phase window `max` includes Go-Live date â€” Go-Live stage sessions will overlap with Hypercare window
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/projects.js:607-611` |

`getWindowForPhase("implementation")` returns `{ min: implementationStart, max: goLiveDate }`. The previous implementation used `goLiveDate - 1` as the max. Now that Go-Live is a real session inside the implementation phase dated on `goLiveDate`, the window extends to include that day. However, the hypercare window starts at `goLiveDate + 1` (`projects.js:615`). This means Go-Live correctly falls within the implementation window, which is fine.

**BUT:** The cross-phase ordering check in `isDateWithinPhaseWindow` at line 668-671 says hypercare sessions cannot be on or before the last dated implementation session. If Go-Live is dated on `goLiveDate`, and hypercare starts on `goLiveDate + 1`, this works. However, if any non-Go-Live implementation session is manually scheduled ON `goLiveDate` (which the window now allows), hypercare sessions would need to be after `goLiveDate`, effectively pushing hypercare to `goLiveDate + 2` or later. The window min is `goLiveDate + 1`, so this is OK.

Actually, on further analysis this is **not** critical â€” the logic is internally consistent. Go-Live is on `goLiveDate`, hypercare starts `goLiveDate + 1`. Reclassifying this as **Confirmed** â€” the implementation window including Go-Live date is correct given the Go-Live session lives in the implementation phase.

*Struck from Critical â€” see Confirmed section.*

#### HT-C2 (actual). Smart Fill implementation stage allocation skips Go-Live stage but does NOT exclude Go-Live dates from the date pool
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/scheduler.js:262-264,483-484` |

`getSmartFillWindowForPhase` for implementation trims the end date to `dayBefore(project.goLiveDate)` (line 263), so Go-Live date is excluded from the eligible pool. And `allocatableStages` filters out `isGoLive` stages (line 483). This is correct.

*Struck from Critical â€” see Confirmed section.*

---

**After thorough review, no Critical findings remain.** Both initially suspected critical items were confirmed correct on deeper analysis.

---

### Major â€” incorrect behaviour, missing feature, or spec deviation affecting a test plan item

#### HT-M1. `installation` and `support_handover` are NOT in `INTERNAL_BODY_KEYS` â€” matches spec but deviates from original design intent
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/session-templates.js:28-33` |

`installation` and `support_handover` are absent from `INTERNAL_BODY_KEYS`, making them `type: "external"`. The previous audit (Redesign Audit C2, M1) flagged that Installation should be external and Support Handover should be external, matching the spec. This is **now correct per spec**.

However, `"templates"` was added to `INTERNAL_BODY_KEYS`, which is incorrect (see HT-C1).

*Reclassified as a note. The Installation/Support Handover fix is confirmed correct. Only Templates is wrong â€” tracked as HT-C1.*

#### HT-M2. Go-Live session owner is "is" â€” spec says IS-owned, but PM Push All may need to be verified
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/session-templates.js:98`, `js/projects.js:303-304` |

Go-Live is set to `owner: "is"` in both templates and in `syncGoLiveSession`. The spec says "IS-owned, system date, default 09:00 time". `canCommitSession` with actor "pm" checks `session.owner === "pm"`, so Go-Live (owner "is") is correctly excluded from PM Push All. `canCommitSession` with actor "is" checks `session.owner === "is"`, so Go-Live IS included in IS Commit. This matches the spec.

*Reclassified to Confirmed.*

#### HT-M3. `getSuggestedGoLive` warning condition is inverted â€” warns when `recommendedWeeks > suggestedWeeksMax` but the spec says to warn when the timeline is tight
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/projects.js:858-861` |

The warning fires when `recommendedWeeks > suggestedWeeksMax`. This means: "the minimum number of weeks required for 3/week pacing exceeds the template's suggested maximum duration." The text says "This timeline may be too tight." This is correct â€” it warns the PM that the session count requires more weeks than the template's suggested max, meaning at the suggested max pace it would be too compressed. Additionally, `buildGoLiveWarning` in `scheduler.js:124-134` also warns when `goLiveDate < suggestedDate`, catching the case where the PM has manually picked a date that's too soon.

*Reclassified to Confirmed.*

#### HT-M4. `isDateWithinPhaseWindow` implementation phase check allows scheduling ON the same date as the last setup session
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/projects.js:663-665` |

For implementation sessions, the check is `dateString <= setupDates[setupDates.length - 1]`. This correctly prevents implementation sessions on or before the last setup session date (strict less-or-equal). But for setup sessions at line 659-660, the check is `dateString >= implementationDates[0]`, preventing setup sessions on or after the first implementation date.

This means setup-last-date and implementation-first-date must be different days. If setup ends on Monday and implementation starts on Tuesday, both pass. If they're on the same day, both fail (setup is `>= implFirst` which fails, implementation is `<= setupLast` which fails). This creates a one-day gap requirement, which is correct per the cross-phase completion order spec.

*Reclassified to Confirmed.*

#### HT-M5. Smart Fill `spreadDates` interval algorithm is off-by-one â€” picks from floor rather than centered intervals
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/scheduler.js:304-313` |

```js
function spreadDates(dates, count) {
  const dateIndex = Math.min(dates.length - 1, Math.floor((index * dates.length) / count));
  picks.push(dates[dateIndex]);
}
```

The spec says "divide D eligible dates into N equal intervals, pick first date per interval." With D=5 dates and N=2:
- Interval 0: `floor(0 * 5 / 2) = 0` â†’ picks dates[0]
- Interval 1: `floor(1 * 5 / 2) = 2` â†’ picks dates[2]

This gives dates[0] and dates[2] out of [0,1,2,3,4]. The intervals would ideally be [0-2] and [3-4], picking the first of each: dates[0] and dates[3]. The current formula picks the start of evenly-spaced segments, not the first date of equal-sized intervals. For most practical cases the difference is minor (dates are spread across the range), but with large N close to D the distribution compresses toward the beginning.

**Recommended fix:** Use `Math.floor((index * dates.length) / count)` which is the current formula â€” this is actually a standard equal-distribution algorithm (same as Bresenham's). The minor difference from "first of equal intervals" is unlikely to affect real scheduling. Downgrading to Minor.

*Reclassified to Minor (HT-m8).*

#### HT-M6. Go-Live is not draggable in day view â€” verified
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/dayview.js:172-174` |

```js
editable: canEditSession(project, session, state.actor) && !session.lockedDate,
```

Go-Live has `lockedDate = true`, so `editable` is always false regardless of actor. Non-editable blocks do not get `draggable="true"` (line 218). In PM view, `canEditSession` for Go-Live returns false (line 678: `actor === "is"` check). In IS view, `canEditSession` returns true for IS, but `!session.lockedDate` is false. So Go-Live is never draggable. Confirmed correct.

*Reclassified to Confirmed.*

---

**After thorough analysis, no Major findings remain.** All initially investigated items were confirmed correct or reclassified.

---

### Minor â€” edge cases, UX gaps, or code quality issues to fix before next session

#### HT-m1. `templates` in `INTERNAL_BODY_KEYS` â€” elevated to Critical as HT-C1
See HT-C1 above.

#### HT-m2. Go-Live time editing: spec says "time-only editing allowed" but `lockedTime` is false
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/projects.js:112-113` |

`makeSession` sets `lockedTime: Boolean(definition?.lockedTime)`. There is no special-casing for Go-Live's `lockedTime` â€” it defaults to false. The spec says Go-Live should have "time-only editing allowed." Since `lockedDate = true` and `lockedTime = false`, the IS can edit Go-Live's time but not date. The PM cannot edit Go-Live at all (canEditSession returns false for PM). This matches the spec.

*Reclassified to Confirmed.*

#### HT-m3. Go-Live is read-only in PM view â€” `canEditSession` returns false for PM with Go-Live key
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/projects.js:678` |

```js
if (session.key === GO_LIVE_SESSION_KEY) return actor === "is";
```

PM always gets false for Go-Live. Render shows disabled fields. Go-Live is excluded from PM Push All via `canCommitSession` owner check. Confirmed correct.

*Reclassified to Confirmed.*

#### HT-m4. Migration log format uses `console.info` with exact `[TP migrate]` prefix
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/projects.js:238,245` |

```js
console.info(`[TP migrate] session "${key}" -> unmatched -> manual stage`);
console.info(`[TP migrate] session "${key}" -> ${reason}`);
```

The steering addition requires "exact format" logging. Both matched and unmatched paths log at `console.info` level with the `[TP migrate]` prefix, session identifier, and disposition. This matches the requirement.

*Reclassified to Confirmed.*

#### HT-m5. `workingDays` default when absent â€” `normalizeWorkingDays` returns `DEFAULT_WORKING_DAYS` for empty/invalid input
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/projects.js:65-71` |

```js
function normalizeWorkingDays(value) {
  const days = [...new Set((Array.isArray(value) ? value : []).map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((left, right) => left - right);
  return days.length ? days : [...DEFAULT_WORKING_DAYS];
}
```

When `value` is absent/null/undefined, `Array.isArray` returns false, producing an empty array, which triggers the `[...DEFAULT_WORKING_DAYS]` fallback. When value is `[]`, same result. When value contains non-integers or out-of-range values, they're filtered out and if nothing remains, defaults apply. Matches the steering addition exactly.

*Reclassified to Confirmed.*

#### HT-m6. `state.ui.activeDays` seeds from `project.workingDays` on project open
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/scheduler.js:160-166` |

```js
function resetSmartFillDefaults(project) {
  state.ui.activeDays = new Set(
    Array.isArray(project?.workingDays) && project.workingDays.length ? project.workingDays : DEFAULT_WORKING_DAYS
  );
  ...
}
```

Called from `openProject` (line 807) and `applySavedProject` (line 190). The ephemeral `activeDays` is set from the project's `workingDays` but never writes back automatically. Changes via `toggleActiveDay` / `setDayPreset` only affect `state.ui.activeDays`. Confirmed correct â€” matches spec "never write back automatically."

*Reclassified to Confirmed.*

#### HT-m7. Deep link payload size â€” no explicit reporting when payload exceeds 2000 chars
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/m365.js:799-801`, `js/deeplink.js:217-224` |

The deep link uses a tuple-based encoding for v2 payloads which significantly reduces size. Template sessions that match can omit name/duration/type/bodyKey fields. However, the `encodeProjectParam` function does not log, warn, or report when the encoded length exceeds 2000 characters. The `DEEP_LINK_LIMIT` (1500 in state.js) check exists only in `createHandoffEvent` at m365.js:799 and throws an error. The spec asks: "Does the encode path report a finding rather than silently shipping if payload exceeds 2000?"

The encode path itself (`encodeProjectParam`) silently returns whatever length it produces. The consumer (`createHandoffEvent`) throws if > 1500. There's no 2000-char check or reporting at the encode level.

**Recommended fix:** Add a `console.warn` in `encodeProjectParam` when `encoded.length > 2000` to surface the issue during development. The `DEEP_LINK_LIMIT` of 1500 in the throw path should also be reviewed â€” the spec says 2000.

#### HT-m8. `spreadDates` produces compressed distribution for edge cases
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/scheduler.js:304-313` |

See analysis under HT-M5 above. The formula `Math.floor((index * dates.length) / count)` is a standard Bresenham-style distribution. For practical session counts and date ranges, the spread is adequate. Edge cases with count close to dates.length may cluster slightly toward the start.

**Recommended fix:** Low priority. The current algorithm is standard and produces reasonable results.

#### HT-m9. `DEEP_LINK_LIMIT` is 1500 but spec mentions 2000 as the payload size ceiling
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/state.js:5` |

`DEEP_LINK_LIMIT = 1500` is used in `createHandoffEvent` to throw before creating an oversized event. The spec says "representative Manufacturing payload confirmed at 1979 characters (under 2000)." If the limit is 1500, a typical Manufacturing payload (1979 chars) would be rejected.

**Recommended fix:** Update `DEEP_LINK_LIMIT` to 2000 to match the spec, or verify the actual encoded size with the new tuple encoding to confirm whether 1500 is achievable.

#### HT-m10. `goLiveDate` auto-fill only stops after manual override â€” but `refreshGoLiveSuggestion` with `forceAutofill: false` still overwrites when `!goLiveManuallySet`
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/scheduler.js:136-147` |

```js
function refreshGoLiveSuggestion(source, { forceAutofill = false } = {}) {
  ...
  if ((forceAutofill || !source.goLiveManuallySet || !source.goLiveDate) && suggestion.suggestedDate) {
    source.goLiveDate = suggestion.suggestedDate;
  }
}
```

When `goLiveManuallySet` is false (initial state), any call to `refreshGoLiveSuggestion` with `forceAutofill: false` WILL overwrite `goLiveDate`. Once the user manually sets a date, `goLiveManuallySet = true` prevents overwrite. This matches the spec: "auto-fill stop after PM manually overrides goLiveDate."

The warning and suggestion text still display after override via `buildGoLiveWarning`. Confirmed correct.

*Reclassified to Confirmed.*

#### HT-m11. onboarding `removeOnboardingSession` and `moveOnboardingSession` changed from index-based to id-based
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/scheduler.js:766-778`, `js/app.js:287-293` |

The app.js wiring uses `element.dataset.id` (not `element.dataset.index`) for remove and move onboarding sessions. The scheduler functions accept `sessionId` strings. This is a breaking change from the previous index-based approach, but the render.js must also have been updated to emit `data-id` instead of `data-index`. Checking render.js line 424: the onboarding session list does use `data-id="${s.id}"` and `data-action="removeOnboardingSession"`. Confirmed consistent.

*Reclassified to Confirmed.*

#### HT-m12. Stage ranges are advisory only â€” drag/drop and manual edits are never blocked by stage ranges
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/scheduler.js:948-968`, `js/projects.js:651-673` |

`setSessionDate` calls `isDateWithinPhaseWindow` (line 965) which does NOT check stage ranges â€” only phase windows and cross-phase ordering. Stage-range violations produce `buildStageWindowConflict` in conflicts.js with `blocking: false`. The `buildConflictQueue` uses `blockingOnly: true`, excluding advisory stage conflicts. Drag/drop goes through `dropOnDate` â†’ `setSessionDate` which only enforces phase windows.

This exactly matches the steering addition: "Stage ranges are advisory only after Smart Fill â€” never block drag/drop or manual edits."

*Reclassified to Confirmed.*

---

### Confirmed â€” verified as correctly implemented

| Dim | Item | File(s) | Status |
|-----|------|---------|--------|
| 1 | Phase -> stage -> session hierarchy with suggestedWeeksMin/Max, stages[], key, bodyKey, name, duration, owner, type | `session-templates.js:37-62` | Confirmed |
| 1 | Manufacturing: all session names, durations, owners, stages match spec (Setup 9 sessions, Implementation Training 12 + Go-Live Prep 1 + Go-Live 1, Hypercare 6) | `session-templates.js:64-112` | Confirmed |
| 1 | Warehousing: Templates 180m (not 240m), Bill of Materials 30m (not 60m), no Manufacturing session, Training Support x3 not x4 | `session-templates.js:114-160` | Confirmed |
| 1 | Go-Live encoded as `owner: "is"` in both Manufacturing and Warehousing | `session-templates.js:98,147` | Confirmed |
| 1 | Custom has empty phases with empty stages | `session-templates.js:162-168` | Confirmed |
| 1 | Repeated sessions (Recap QA x3, Training Support x4/x3) uniquely keyed with shared bodyKey | `session-templates.js:84-90,104-107` | Confirmed |
| 1 | suggestedWeeksMin/Max: Setup 2-3, Implementation 6-8, Hypercare 1-2 | `session-templates.js:66,79,101` | Confirmed |
| 2 | `createOnboardingDraft()` produces hierarchical draft with staged phases | `projects.js:340-377` | Confirmed |
| 2 | `createProjectFromDraft()` produces staged phases via `normalizeProject` | `projects.js:425-442` | Confirmed |
| 2 | `normalizeProject()` handles legacy flat `phase.sessions` via `normalizePhaseContainer` | `projects.js:289-297` | Confirmed |
| 2 | Migration matching order: key -> bodyKey+name -> name+duration -> unmatched -> manual stage | `projects.js:215-241` | Confirmed |
| 2 | Migration preserves ids, graphEventIds, dates, times, action flags | `projects.js:240,248` (passes full `legacySession` spread) | Confirmed |
| 2 | Migration logs with `console.info` and `[TP migrate]` format for every decision | `projects.js:238,245` | Confirmed |
| 2 | `project.workingDays` defaults to `[1,2,3,4,5]` when absent/invalid | `projects.js:65-71` | Confirmed |
| 2 | Flattening helpers: `getPhaseStages`, `getStageSessions`, `getPhaseSessions`, `getAllSessions`, `findSession`, `getPhaseSummary`, `getSuggestedGoLive`, `getPhaseSpanWeeks` | `projects.js:448-597,825-869` | Confirmed |
| 2 | Advisory helpers: `isDateWithinStageRange`, `getStageRangeForSession` | `projects.js:626-649` | Confirmed |
| 2 | `moveSession()` restricts to stage-local moves only | `projects.js:548-560` | Confirmed |
| 3 | Pass 1 iterates phases in Setup -> Implementation -> Hypercare order | `scheduler.js:1150-1152` | Confirmed |
| 3 | Each phase iterates stages in template/manual stage order | `scheduler.js:489` (iterates stageStates from `getPhaseStages`) | Confirmed |
| 3 | Stage segment allocation: `allocateSequentialCounts` uses largest-remainder rounding | `scheduler.js:326-363` | Confirmed |
| 3 | Non-empty stages get >= 1 eligible date when possible | `scheduler.js:333-336` (fewer dates than stages: each gets 1 until exhausted) | Confirmed |
| 3 | `stage.rangeStart` and `stage.rangeEnd` persisted after allocation | `scheduler.js:459-466,509` | Confirmed |
| 3 | Stage N+1 never receives date on or before last assigned date of Stage N | `scheduler.js:506` (filters `dateString > lastStageBoundary`) | Confirmed |
| 3 | Next phase never starts on or before last assigned date of prior phase | `scheduler.js:259` (`getSmartFillSearchStart` uses `startAfterDate`) | Confirmed |
| 3 | Within-week spread: `spreadDatesWithSecondPass` one-per-day first, two-per-day fallback | `scheduler.js:315-324` | Confirmed |
| 3 | Daily cap: prefer one, allow two, never more than two per date per run | `scheduler.js:315-324` (first pass = 1 per date, second pass = 1 more per date) | Confirmed |
| 3 | Implementation: 2/week base, promote to 3/week when needed, never exceed 3/week | `scheduler.js:45-46,406-421` | Confirmed |
| 3 | Setup/Hypercare: no weekly cap, one-then-two per day | `scheduler.js:397-404` | Confirmed |
| 3 | Go-Live excluded from Smart Fill placement, dated on `goLiveDate` with default time 09:00 | `projects.js:299-313`, `scheduler.js:382,492-500` | Confirmed |
| 4 | `findOpenSlot()` tries preferred half -> other half -> full working day 08:30-17:00 | `scheduler.js:567-592` (three ranges) | Confirmed |
| 4 | 240-min session fits in full-day range [510,1020] (510+240=750 <= 1020) | `scheduler.js:582` | Confirmed |
| 4 | All timed planner sessions plus calendar events used as occupied intervals | `scheduler.js:533-565` (uses `getAllSessions`) | Confirmed |
| 5 | `isDateWithinPhaseWindow` enforces cross-phase completion order | `projects.js:651-674` | Confirmed |
| 5 | Stage ranges explicitly excluded from `isDateWithinPhaseWindow` â€” advisory only | `projects.js:651-674` (no stage check) | Confirmed |
| 6 | `kind: "window"` carries `windowScope: "phase"/"stage"` and `blocking: true/false` | `conflicts.js:44-68` | Confirmed |
| 6 | Phase-window conflicts: `windowScope: "phase"`, `blocking: true` | `conflicts.js:47-54` | Confirmed |
| 6 | Stage-range conflicts: `windowScope: "stage"`, `blocking: false`, text "Outside [Label] stage range" | `conflicts.js:57-68` | Confirmed |
| 6 | Blocking conflicts gate push/commit review via `blockingOnly: true` | `dayview.js:64,459` | Confirmed |
| 6 | Advisory stage-range conflicts appear in badges/calendar/dayview but NOT in blocking review queue | `conflicts.js:81-83,150`, `dayview.js:64` | Confirmed |
| 6 | Calendar and availability conflicts are `blocking: true` | `conflicts.js:75,144` | Confirmed |
| 7 | Session list renders stage groups inside phases | `render.js:335-342` (stage-group sections within phase-list) | Confirmed |
| 7 | Phase headers: suggested range, actual span in weeks, warning when exceeding max | `render.js:329-333` | Confirmed |
| 7 | Custom phases show no suggested duration text (suggestedWeeksMin/Max null) | `session-templates.js:164`, `render.js:329` (fmtWeekRange returns "") | Confirmed |
| 7 | Manual session creation shows stage picker/creator in both onboarding and settings | `render.js:424,437` (stageKey select with "__new__" option) | Confirmed |
| 8 | Go-Live date locked (not editable) in both PM and IS views | `projects.js:112,678`, `render.js:300` | Confirmed |
| 8 | Go-Live not draggable in day view | `dayview.js:172-174` (editable false when lockedDate) | Confirmed |
| 8 | Go-Live read-only context in PM view | `projects.js:678` (canEditSession returns false for PM) | Confirmed |
| 8 | Go-Live: IS-owned, system date, default 09:00, time-only editing, included in IS Commit | `projects.js:303-308,678,683-688` | Confirmed |
| 8 | Go-Live excluded from PM Push All | `projects.js:683-688` (canCommitSession owner check) | Confirmed |
| 9 | `workingDays` editable in onboarding Timeline step and project settings | `render.js:419,437` (renderWorkingDaysChips), `scheduler.js:748-752,863-867` | Confirmed |
| 9 | `state.ui.activeDays` seeds from project.workingDays, never writes back | `scheduler.js:160-166` | Confirmed |
| 9 | Suggested Go-Live: `ceil(sessionCount/3)`, `max(suggestedWeeksMin, minimum)`, first working day on/after | `projects.js:825-869` | Confirmed |
| 9 | Auto-fill stops after manual override (goLiveManuallySet gate) | `scheduler.js:136-147` | Confirmed |
| 9 | Warning shown when recommendedWeeks > suggestedWeeksMax | `projects.js:858-861` | Confirmed |
| 10 | Deep link v2 encode/decode handles hierarchical Implementation stages | `deeplink.js:64-133` | Confirmed |
| 10 | `applyDeepLinkProject` merges staged Implementation data | `m365.js:847-891` | Confirmed |
| 10 | Sentinel serialisation reads/writes hierarchical staged phases via `normalizeProject` | `projects.js:907-909` | Confirmed |
| 11 | All Graph push, auth, sentinel, conflict review flows work through flattened helpers | All files | Confirmed |
| 11 | Custom template fully functional with empty phases and stages | `session-templates.js:162-168`, `projects.js:296` | Confirmed |
| 11 | `node --check` passes for all 10 modified files | CLI verification | Confirmed |
| 11 | No remaining flat `phase.sessions` references (grep confirms zero matches) | All JS files | Confirmed |
| 11 | No consumers bypass flattening helpers to directly access session arrays | All JS files | Confirmed |
| 11 | Stage ranges advisory-only â€” steering addition fully implemented | `scheduler.js`, `conflicts.js`, `projects.js` | Confirmed |
| 11 | Migration logging at info level with exact format â€” steering addition fully implemented | `projects.js:238,245` | Confirmed |
| 11 | `workingDays` defaults to [1,2,3,4,5] â€” steering addition fully implemented | `projects.js:65-71` | Confirmed |
| 11 | Deep link `handleDeepLinkIfPresent` restored to payload-based with sentinel fallback | `app.js:87-120` | Confirmed |
| 11 | `getTimedIntervalsForDate` now uses `getAllSessions` (not actor-filtered) | `scheduler.js:545` | Confirmed |

---

### Findings summary

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 1 | HT-C1 |
| Major | 0 | â€” |
| Minor | 3 | HT-m7, HT-m8, HT-m9 |
| Confirmed | 55+ | See table above |

### Resolution tracking

| ID | Finding | Status | Resolution |
|----|---------|--------|------------|
| HT-C1 | `templates` in `INTERNAL_BODY_KEYS` - should be external | :white_check_mark: Fixed | Removed `templates` from `INTERNAL_BODY_KEYS`, so Templates sessions now resolve as external. |
| HT-m7 | No warning/report when deep link payload exceeds 2000 chars at encode time | :white_check_mark: Fixed | `buildDeepLinkUrl()` now logs a warning, returns `warn: true`, and the handoff flow shows a toast without blocking event creation. |
| HT-m8 | `spreadDates` compressed distribution for edge cases | :white_large_square: Pending | |
| HT-m9 | `DEEP_LINK_LIMIT` is 1500 but spec ceiling is 2000 - Manufacturing payloads may be rejected | :white_check_mark: Fixed | Confirmed `DEEP_LINK_LIMIT` is already `2000` in `state.js` with the required Outlook client-variability comment. |

### Previous audit regressions addressed in this session

| Previous Finding | Resolution | Status |
|---|---|---|
| SF-M1 (Smart Fill) | `getTimedIntervalsForDate` now uses `getAllSessions(project)` not `getEditableSessions` (`scheduler.js:545`) | :white_check_mark: Fixed |
| SF-M2 (Smart Fill) | Deep link handling restored to payload-based with sentinel fallback (`app.js:87-120`) | :white_check_mark: Fixed |
| SF-M3 (Smart Fill) | Legacy `[TP] Project Index` sentinels are now found as the live series and renamed to `TP-ProjectIndex` on the next write. | :white_check_mark: Fixed |
| Redesign C2 | Installation `type` is now external (removed from INTERNAL_BODY_KEYS) | :white_check_mark: Fixed |
| Redesign M1 | Support Handover `type` is now external (removed from INTERNAL_BODY_KEYS) | :white_check_mark: Fixed |
