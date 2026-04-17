# Repository Audit

Date: 2026-04-17

This document captures the current review findings for code quality, best practice gaps, and inefficiencies so they can be addressed separately later.

## Resolved Since Audit

1. Item 1 fixed: out-of-office (`showAs: "oof"`) events are now retained in calendar normalization, so Smart Fill and conflict checks treat leave as blocking availability.

2. Item 2 fixed: manual date entry now rejects true phase-window violations instead of warning and persisting anyway, while single-session Push now refreshes calendar context and routes the user into conflict review if that session still has blocking conflicts.

3. Item 3 fixed: stage date ranges are now recomputed through a shared helper after session removal, unscheduling, and bulk date-clear flows so stage-range conflicts and UI summaries do not retain stale dates.

4. Item 4 fixed: the handoff and close-notification Graph HTML bodies now escape project-controlled values consistently, matching the safer invite-body behavior and preventing broken markup or HTML injection through project metadata.

5. Item 5 fixed: batch push now suppresses per-session sentinel writes and persists the project index once after the batch, while preserving single-session push behavior and still persisting PM partial pushes correctly.

6. Gap item 2 fixed: rendering now uses stable topbar, main, and overlay slots with unchanged-markup skips, instead of replacing the entire app DOM on every rerender. This reduces unnecessary subtree rewrites and preserves interactive regions like the toast container more reliably.

7. Gap item 1 fixed: the test suite now covers targeted scheduler, render, and `m365` behaviors, including manual date validation, stage-range recomputation, render-slot diffing, HTML escaping, push rollback on persistence failure, and single-persist batch push behavior.

## Findings

### High

1. Out-of-office time is treated as available.

In [js/m365.js](./js/m365.js), the calendar fetch drops events where `showAs === "oof"`, so vacations and leave never reach conflict detection or Smart Fill. That allows the planner to schedule sessions over real absences.

Relevant references:

- [js/m365.js:684](./js/m365.js)
- [js/m365.js:686](./js/m365.js)

2. Invalid window placements are warned about but still persisted, and single-session push bypasses the conflict-review workflow. Resolved on current branch.

`setSessionDate` shows a toast when a date is outside the phase window, but still writes the date into the project state. Separately, the per-session Push button is available for any dated/timed committable session and dispatches directly to `pushSessionToCalendar`, which does not re-check conflicts before writing to Microsoft Graph.

That means a user can push a session that is already known to be outside the allowed window or colliding with calendar data.

Relevant references:

- [js/scheduler.js:1169](./js/scheduler.js)
- [js/scheduler.js:1178](./js/scheduler.js)
- [js/render.js:514](./js/render.js)
- [js/app.js:610](./js/app.js)
- [js/m365.js:580](./js/m365.js)

### Medium

3. Stage ranges go stale after unscheduling or removal. Resolved on current branch.

`setSessionDate` recomputes `stage.rangeStart` and `stage.rangeEnd`, but `unscheduleSession` and `removeSession` do not. Those stage ranges are used both in conflict logic and in the rendered UI, so the app can show incorrect stage windows and false "outside stage range" conflicts after edits.

Relevant references:

- [js/scheduler.js:1184](./js/scheduler.js)
- [js/scheduler.js:1251](./js/scheduler.js)
- [js/projects.js:551](./js/projects.js)
- [js/conflicts.js:58](./js/conflicts.js)
- [js/render.js:543](./js/render.js)

4. HTML escaping is inconsistent in outbound Graph event bodies. Resolved on current branch.

The main invite builder escapes user-controlled fields before interpolating them into HTML, but the handoff and close-notification event builders interpolate raw project metadata directly into HTML bodies.

This creates a risk of broken markup and HTML injection from project metadata such as client names or user names.

Relevant references:

- [js/invites.js:77](./js/invites.js)
- [js/m365.js:798](./js/m365.js)
- [js/m365.js:803](./js/m365.js)
- [js/m365.js:1009](./js/m365.js)
- [js/m365.js:1014](./js/m365.js)

### Low

5. Batch push is needlessly expensive and increases failure surface. Resolved on current branch.

The bulk push path loops through sessions and calls `pushSessionToCalendar` for each one. Each of those calls persists the full sentinel immediately, and the batch path then persists again afterward.

For larger projects, that turns one bulk operation into many full Graph writes and increases the chance of partial failure states.

Relevant references:

- [js/m365.js:580](./js/m365.js)
- [js/m365.js:598](./js/m365.js)
- [js/m365.js:765](./js/m365.js)
- [js/m365.js:781](./js/m365.js)

## Gaps And Risk

1. Automated test coverage is narrow. Resolved on current branch.

The existing test suite originally covered only:

- [tests/projects.test.js](./tests/projects.test.js)
- [tests/calendar-sources.test.js](./tests/calendar-sources.test.js)

Additional targeted coverage now exists for the previously untested high-risk modules:

- [js/scheduler.js](./js/scheduler.js)
- [js/m365.js](./js/m365.js)
- [js/render.js](./js/render.js)

2. Rendering replaces the entire app DOM on each rerender. Resolved on current branch.

The current rendering model is simple and workable at this size, but it will become a performance and UX bottleneck as project counts and calendar density grow because the full app markup is rewritten on each render.

Relevant reference:

- [js/render.js:713](./js/render.js)

## Verification

- Repository tests reviewed and executed with `npm test`
- Current branch result: 37 passing, 0 failing
