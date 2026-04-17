import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyCalendarSourceError,
  createCalendarAvailabilityState,
  filterCalendarEventsByPhase,
  getCalendarFetchPlan,
  getCalendarOwnerForPhase,
  getCalendarSourceReadiness,
  getDayViewExternalOwners,
} from "../js/calendar-sources.js";

test("phase owner mapping stays stable across the project lifecycle", () => {
  assert.equal(getCalendarOwnerForPhase("setup"), "pm");
  assert.equal(getCalendarOwnerForPhase("implementation"), "is");
  assert.equal(getCalendarOwnerForPhase("hypercare"), "pm");
});

test("PM fetch plan loads both PM and IS calendars when IS email is present", () => {
  const plan = getCalendarFetchPlan({
    actor: "pm",
    project: {
      pmEmail: "pm@example.com",
      isEmail: "is@example.com",
    },
  });

  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(
    plan.sources.map((source) => ({ owner: source.owner, userId: source.userId })),
    [
      { owner: "pm", userId: "me" },
      { owner: "is", userId: "is@example.com" },
    ]
  );
});

test("PM fetch plan blocks implementation source immediately when IS email is missing", () => {
  const plan = getCalendarFetchPlan({
    actor: "pm",
    project: {
      pmEmail: "pm@example.com",
      isEmail: "",
    },
  });

  assert.deepEqual(
    plan.sources.map((source) => source.owner),
    ["pm"]
  );
  assert.equal(plan.warnings.length, 1);
  assert.equal(plan.warnings[0].code, "implementation_missing_email");
  assert.match(plan.warnings[0].message, /Add the IS email/i);
});

test("IS fetch plan stays on the current mailbox", () => {
  const plan = getCalendarFetchPlan({
    actor: "is",
    project: {
      isEmail: "is@example.com",
    },
  });

  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.sources, [
    {
      owner: "is",
      userId: "me",
      mailbox: "is@example.com",
      phaseKey: "implementation",
      phaseKeys: ["implementation"],
    },
  ]);
});

test("shared calendar 403 returns a phase-specific implementation block", () => {
  const warning = classifyCalendarSourceError({
    owner: "is",
    actor: "pm",
    error: { status: 403, message: "ErrorAccessDenied" },
    project: { isEmail: "is@example.com" },
  });

  assert.equal(warning.owner, "is");
  assert.equal(warning.phaseKey, "implementation");
  assert.equal(warning.code, "implementation_share_missing");
  assert.match(warning.message, /share their Outlook calendar/i);
});

test("shared calendar 404 returns a phase-specific implementation block", () => {
  const warning = classifyCalendarSourceError({
    owner: "is",
    actor: "pm",
    error: { status: 404, message: "Resource not found" },
    project: { isEmail: "is@example.com" },
  });

  assert.equal(warning.owner, "is");
  assert.equal(warning.phaseKey, "implementation");
  assert.equal(warning.code, "implementation_mailbox_unavailable");
  assert.match(warning.message, /Check the IS email and Outlook calendar share/i);
});

test("owner-based event filtering keeps Smart Fill and conflicts on the correct calendar", () => {
  const events = [
    { id: "pm:1", calendarOwner: "pm", subject: "PM busy" },
    { id: "is:1", calendarOwner: "is", subject: "IS busy" },
  ];

  assert.deepEqual(
    filterCalendarEventsByPhase(events, "setup").map((event) => event.subject),
    ["PM busy"]
  );
  assert.deepEqual(
    filterCalendarEventsByPhase(events, "implementation").map((event) => event.subject),
    ["IS busy"]
  );
});

test("day view shows both calendars for PM, own calendar for IS", () => {
  assert.deepEqual(getDayViewExternalOwners({ actor: "pm" }), ["pm", "is"]);
  assert.deepEqual(getDayViewExternalOwners({ actor: "is" }), ["is"]);
});

test("per-source readiness blocks only the unavailable calendar owner", () => {
  const availability = createCalendarAvailabilityState({
    projectId: "p1",
    rangeStart: "2026-04-01",
    rangeEnd: "2026-04-30",
    sources: {
      pm: { status: "ready", loadedAt: "2026-04-01T00:00:00Z" },
      is: { status: "blocked", errorCode: "implementation_share_missing", error: "share missing" },
    },
  });

  const pmReadiness = getCalendarSourceReadiness({
    availability,
    owner: "pm",
    projectId: "p1",
    requiredRange: { start: "2026-04-10", end: "2026-04-20" },
  });
  const isReadiness = getCalendarSourceReadiness({
    availability,
    owner: "is",
    projectId: "p1",
    requiredRange: { start: "2026-04-10", end: "2026-04-20" },
  });

  assert.equal(pmReadiness.ready, true);
  assert.equal(isReadiness.ready, false);
  assert.equal(isReadiness.reason, "blocked");
});
