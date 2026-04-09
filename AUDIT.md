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

---

## Full Repository Cross-Cutting Audit — 2026-04-09

**Scope:** All 12 JS modules, index.html, styles/app.css — full static read of every file.
**Method:** Cross-cutting review across all eight focus areas listed below. No browser or live Graph test.
**Context:** Post three major architectural changes (M365 redesign, Smart Fill rebuild, hierarchical templates). First full repository audit; all previous audits were incremental.

---

### Critical — breaks core functionality or would cause data loss in production

No critical findings.

---

### Major — incorrect behaviour or missing guard that affects a real user flow

No major findings.

---

### Minor — edge cases, missing null checks, or inconsistencies that should be cleaned up

#### XCA-m1. Double `loadProjectsFromSentinel` on auto-sign-in startup
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/app.js:601`, `js/m365.js:939-941` |

For users with a restored MSAL session, `init()` calls `bootstrapMsal()` which internally calls `loadProjectsFromSentinel()` (m365.js:940). Then `init()` calls `loadProjectsFromSentinel()` again at app.js:601. Both calls reach `fetchSentinel()`, making two full Graph calendarView reads of the same sentinel on every auto-sign-in page load.

The second call is redundant — `bootstrapMsal` already loaded projects and set the screen. The second call re-fetches identical data and re-sets `state.projects` to the same list.

**Recommended fix:** Remove the explicit `loadProjectsFromSentinel()` call in `init()` (app.js:601). `bootstrapMsal` already handles it when `state.graphAccount` is set. The subsequent `handleDeepLinkIfPresent` and `refreshProjectContext` calls can proceed as-is since they only depend on `state.projects` being populated, which `bootstrapMsal` ensures.

#### XCA-m2. `pushSessionToCalendar` mutates in-memory state before sentinel persist succeeds
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/m365.js:586-598` |

In the try block, `pushGraphEvent` creates/updates the calendar event, then lines 587-590 immediately set `found.session.graphEventId` and `found.session.graphActioned = true`. The `persistActiveProjects()` call follows at line 592. If `persistActiveProjects` throws (sentinel write fails), the catch block fires but the in-memory session already has `graphActioned = true` and the real `graphEventId`.

In the current session this is self-healing — the next successful persist from any action will save the updated state. But if the user closes the browser between the push-success/persist-failure, the sentinel still has the old state. On next load, the session appears unpushed, and re-pushing creates a duplicate calendar event (POST instead of PATCH since `graphEventId` was lost).

**Recommended fix:** Capture the event ID in a local variable, call `persistActiveProjects()` first, and only set `found.session.graphEventId` and `graphActioned` after persist succeeds. On persist failure, the calendar event exists but the session remains "unpushed" — the user can re-push safely (as a POST, which is a duplicate but at least a visible one).

#### XCA-m3. `syncProjectToPartnerSentinel` catch block can throw from inner persist
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/m365.js:788-792` |

When `writeProjectToUserSentinel` fails, the catch block sets `project.handoff.pendingPmSync = true` (line 789) and then calls `await persistActiveProjects()` (line 790). If `persistActiveProjects` also throws, that error propagates out of the catch block unhandled within `syncProjectToPartnerSentinel`. The caller (`pushOwnedSessions`, line 704) does not catch it, so it propagates to the top-level action handler in app.js — which does catch it and shows a toast.

The user sees an opaque "Graph error" toast. The `pendingPmSync` flag is set in memory but not persisted, and the partner sentinel was not updated.

**Recommended fix:** Wrap the `persistActiveProjects()` call inside the catch block in its own try/catch, logging the nested failure without re-throwing.

#### XCA-m4. Deep link encode drops stage `rangeStart`/`rangeEnd`; merge clears existing IS ranges on re-handoff
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/deeplink.js:67`, `js/projects.js:877-879` |

`encodeImplementationStages` (deeplink.js:67) encodes each stage as `[key, label, sessions[]]`. Stage `rangeStart` and `rangeEnd` are not included in the tuple. On decode, `decodeImplementationStages` produces stages with no `rangeStart`/`rangeEnd`. `makeStage` defaults them to `""`.

In `mergeDeepLinkProject` (projects.js:877), the merged project uses `incomingProject.phases.implementation`, which has empty stage ranges. If the IS had previously run Smart Fill and established stage ranges, those ranges are silently replaced with empty strings.

Stage ranges are advisory (non-blocking) and can be recalculated by re-running Smart Fill. No data loss occurs, but the IS loses visual range context until Smart Fill is re-run.

**Recommended fix:** Either encode `rangeStart`/`rangeEnd` in the stage tuple (adds ~20 chars per stage to the deep link), or document that re-handoff clears advisory ranges and prompt IS to re-run Smart Fill.

#### XCA-m5. Dead `status: payload.st` reference in `applyDeepLinkProject`
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/m365.js:861` |

`applyDeepLinkProject` passes `status: payload.st` to `normalizeProject`. The v2 deep link payload (`getDeepLinkPayload` in deeplink.js:199-216) does not include an `st` field, so `payload.st` is always `undefined`. `normalizeProject` defaults it to `"scheduling"`, and then `deriveProjectStatus` immediately overwrites it at projects.js:417. The field assignment is dead code with no runtime effect.

**Recommended fix:** Remove `status: payload.st` from the `normalizeProject` call in `applyDeepLinkProject`.

#### XCA-m6. `readyForHandoff` returns true for projects with zero implementation sessions
| | |
|---|---|
| **Status** | :white_large_square: Pending |
| **File** | `js/projects.js:750-752`, `js/scheduler.js:1206-1208` |

`projectHasImplementationReady` calls `getPhaseSessions(project, "implementation").every(s => s.date && s.time)`. `Array.prototype.every()` on an empty array returns `true`. For custom-type projects with no implementation sessions, `readyForHandoff` returns `true`, and the PM sees the "Hand Off to IS" button.

Clicking it creates a handoff event with an empty `impl` array in the deep link. The IS receives a project with zero implementation sessions, which is a valid but likely unintended state.

**Recommended fix:** Add an early return in `projectHasImplementationReady`: if `sessions.length === 0` return `false`.

---

### Confirmed clean — focus areas checked and verified

| Focus Area | Verdict | Key evidence |
|---|---|---|
| **1. Stale call sites after hierarchical model** | Clean | No flat `phase.sessions` references outside migration code (`normalizePhaseContainer` line 293 is the migration entry point). All callers of `getPhaseSessions`, `getAllSessions`, `getStageSessions`, `findSession` pass correct project objects with hierarchical `phases.*.stages[].sessions[]` structure. `session.phase` and `session.stageKey` are always set by `makeSession` (projects.js:101-104) and re-normalised by `normalizePhaseOrders` (projects.js:159-166). |
| **2. Sentinel round-trip integrity** | Clean | Write path: `serializeSentinelProjects` → `normalizeProject` → JSON-stringify into extension payload. Read path: `parseSentinelExtension` → JSON-parse → `normalizeProject`. Both paths produce identical shapes. `rangeStart`/`rangeEnd` survive: written by `makeStage` (projects.js:125-126), read back by `normalizeModernPhase` (projects.js:275-276) → `makeStage`. Missing fields (e.g., from older sentinel versions) get defaults during normalisation. `suggestedWeeksMin`/`suggestedWeeksMax` fall back to template values when absent (projects.js:262-263). |
| **3. Deep link encode/decode integrity** | Clean (with XCA-m4 caveat) | Session fields: `id`, `key`, `date`, `time` always encoded; `name`, `duration`, `type`, `bodyKey` conditionally encoded for non-template sessions (deeplink.js:43-63). Fields not encoded (`graphEventId`, `graphActioned`, `outlookActioned`) are correctly reconstituted by `mergeDeepLinkProject` reconciliation loop (projects.js:884-901). `warn: true` from `buildDeepLinkUrl` is handled by `createHandoffEvent` with a non-blocking toast (m365.js:799-801). Decode handles both tuple arrays and legacy object payloads (deeplink.js:74-99, 136-197). |
| **4. Async error handling in m365.js** | Clean (with XCA-m2/m3 caveats) | All major async flows have error boundaries: `initMsal` has `.catch()` returning null (m365.js:127-133); `getAccessToken` has nested try/catch for silent/popup (m365.js:139-166); `loadProjectsFromSentinel` has try/catch setting sentinel error state (m365.js:424-447); `fetchCalendarEvents` has try/catch resetting events and availability (m365.js:638-681); `pushSessionToCalendar` has try/catch (m365.js:585-599); all action handlers wrapped by top-level click handler catch (app.js:504-513). No missing `await` on async calls found. |
| **5. Conflict pipeline correctness** | Clean | `blockingOnly: true` used for all push/commit gate decisions: `buildConflictQueue` (dayview.js:64), `confirmConflict` (dayview.js:459), `conflictButton` in render (render.js:193), `checkConflicts` action (app.js:416). Advisory stage-range conflicts correctly carry `blocking: false` (conflicts.js:64) and are excluded by `filterBlocking` (conflicts.js:81-83). Conflict review queue uses `scope: "review"` → `getConflictReviewSessions` (conflicts.js:37), not `getPushableSessions`. `availabilityConflict` field always present on sessions via `makeSession` (projects.js:114); reads use truthiness (conflicts.js:133) or strict equality (render.js:400), both safe for `undefined`. |
| **6. Render and dayview stale assumptions** | Clean | All session iteration goes through `getAllSessions` or `getPhaseStages`: render.js calendar panel (line 367, 374), dayview.js session blocks (line 164), dayview.js external events (line 141). No hardcoded phase key strings for rendering decisions — `getVisiblePhaseKeys`/`getContextPhaseKeys` used throughout (render.js:346-347, dayview.js:160-161). Blank-time sessions handled: `getTimeOptionsHTML` shows "Time needed" (utils.js:78-86), `fmtTimeLabel` returns "Time needed" (render.js:37-38), dayview splits timed/untimed into separate render paths (dayview.js:168). Push/invite buttons correctly suppressed for internal sessions: `canCommitSession` returns false for `type === "internal"` (projects.js:685), Outlook button guarded by `session.type === "external"` (render.js:311). |
| **7. IS/PM boundary enforcement** | Clean | `canEditSession`: IS can only edit implementation sessions and Go-Live (projects.js:676-681). `canCommitSession`: PM can only commit PM-owned, IS can only commit IS-owned (projects.js:683-688). Go-Live: `canEditSession` returns false for PM (line 678), not draggable due to `lockedDate` (dayview.js:172). Handoff button gated by `state.actor === "pm" && readyForHandoff(project)` (render.js:407). Move/remove buttons restricted to PM via `state.actor === "pm" && editable` (render.js:312). |
| **8. invites.js decoupling** | Clean | Zero DOM global references (`globalClient`, `globalOrganiser`, etc.) in invites.js or any invite-payload-building code. All project/session data accessed through `getActiveProject()` (invites.js:8), `findSession()` (invites.js:10), and function parameters. `buildEventPayload` in m365.js (line 510-543) delegates to `buildSubject` and `buildBodyHTML` from invites.js — no direct DOM access. |

---

### Resolution tracking

| ID | Finding | Status | Resolution |
|----|---------|--------|------------|
| XCA-m1 | Double `loadProjectsFromSentinel` on auto-sign-in — redundant sentinel read | :white_check_mark: Fixed | Removed redundant `loadProjectsFromSentinel()` call and unused import from `init()` in app.js. `bootstrapMsal` already handles the load. |
| XCA-m2 | `pushSessionToCalendar` mutates state before persist — potential duplicate events on persist failure | :white_check_mark: Fixed | Added rollback of `graphEventId` and `graphActioned` on persist failure in m365.js `pushSessionToCalendar`. Inner try/catch around `persistActiveProjects` restores previous values and re-throws. |
| XCA-m3 | `syncProjectToPartnerSentinel` catch block can re-throw from nested persist | :white_check_mark: Fixed | Wrapped `persistActiveProjects()` in its own try/catch inside the catch block of `syncProjectToPartnerSentinel` in m365.js. Nested failure is logged without re-throwing. |
| XCA-m4 | Deep link encode drops stage ranges — merge clears IS advisory ranges on re-handoff | :white_check_mark: Fixed | Documented as intentional. Added comment in `encodeImplementationStages` (deeplink.js): ranges are advisory only, recalculated by IS via Smart Fill. No code change. |
| XCA-m5 | Dead `status: payload.st` reference in `applyDeepLinkProject` | :white_check_mark: Fixed | Removed `status: payload.st` from the `normalizeProject` call in `applyDeepLinkProject` (m365.js). |
| XCA-m6 | `readyForHandoff` true on zero implementation sessions (empty `every()`) | :white_check_mark: Fixed | Added `sessions.length > 0` guard in `projectHasImplementationReady` (projects.js). Empty implementation now returns false. |

### Findings summary

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 0 | — |
| Major | 0 | — |
| Minor | 6 | XCA-m1, XCA-m2, XCA-m3, XCA-m4, XCA-m5, XCA-m6 |
| Confirmed clean | 8/8 focus areas | See table above |
