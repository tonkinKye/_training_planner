import test from "node:test";
import assert from "node:assert/strict";

import { createCalendarAvailabilityState } from "../js/calendar-sources.js";
import { applySmartFill, unscheduleSession, validateSessionDateChange } from "../js/scheduler.js";
import { resetAppState, state } from "../js/state.js";

let nextId = 1;

function makeSession(overrides = {}) {
  return {
    id: `scheduler-test-${nextId++}`,
    key: "test_session",
    name: "Test",
    durationMinutes: 90,
    duration: 90,
    phase: "setup",
    stageKey: "s1",
    owner: "pm",
    type: "external",
    order: 1,
    date: "",
    time: "",
    locked: false,
    lockedDate: false,
    lockedTime: false,
    graphEventId: "",
    graphActioned: false,
    outlookActioned: false,
    availabilityConflict: false,
    ...overrides,
  };
}

function makeProject({
  projectStart = "2099-04-22",
  implementationStart = "2099-05-20",
  goLiveDate = "2099-07-01",
  hypercareDuration = "1 week",
  setupSessions = [],
  implSessions = [],
  hcSessions = [],
} = {}) {
  return {
    projectStart,
    implementationStart,
    goLiveDate,
    hypercareDuration,
    phases: {
      setup: {
        owner: "pm",
        suggestedWeeksMin: null,
        suggestedWeeksMax: null,
        stages: [
          {
            key: "setup_stage_1",
            label: "Setup",
            order: 0,
            rangeStart: "",
            rangeEnd: "",
            sessions: setupSessions,
          },
        ],
      },
      implementation: {
        owner: "is",
        suggestedWeeksMin: null,
        suggestedWeeksMax: null,
        stages: [
          {
            key: "impl_stage_1",
            label: "Impl",
            order: 0,
            rangeStart: "",
            rangeEnd: "",
            sessions: implSessions,
          },
        ],
      },
      hypercare: {
        owner: "pm",
        suggestedWeeksMin: null,
        suggestedWeeksMax: null,
        stages: [
          {
            key: "hc_stage_1",
            label: "HC",
            order: 0,
            rangeStart: "",
            rangeEnd: "",
            sessions: hcSessions,
          },
        ],
      },
    },
  };
}

test("manual date validation rejects setup dates before projectStart when no earlier setup session exists", () => {
  const project = makeProject();
  const session = makeSession({ phase: "setup", date: "2099-04-23" });
  project.phases.setup.stages[0].sessions = [session];

  assert.deepEqual(
    validateSessionDateChange(project, session, "2099-04-21"),
    {
      ok: false,
      reason: "phase_window",
      message: "Date is outside the phase window",
    }
  );
});

test("manual date validation allows the pre-projectStart setup edge case when an earlier setup session already exists", () => {
  const project = makeProject();
  const internalSession = makeSession({
    phase: "setup",
    type: "internal",
    key: "sales_handover",
    order: 0,
    date: "2099-04-21",
  });
  const externalSession = makeSession({
    phase: "setup",
    type: "external",
    key: "installation",
    order: 1,
    date: "2099-04-22",
  });
  const kickOff = makeSession({
    phase: "setup",
    type: "external",
    key: "kick_off_call",
    order: 2,
    date: "2099-04-22",
  });
  project.phases.setup.stages[0].sessions = [internalSession, externalSession, kickOff];

  assert.deepEqual(
    validateSessionDateChange(project, externalSession, "2099-04-21"),
    {
      ok: true,
      reason: "",
      message: "",
    }
  );
});

test("Smart Fill keeps internal buffer placement, phase gate placement, and locked go-live anchors in phase order", () => {
  resetAppState();

  try {
    const internalSetup = makeSession({
      phase: "setup",
      type: "internal",
      key: "sales_handover",
      order: 0,
    });
    const kickOff = makeSession({
      phase: "setup",
      type: "external",
      key: "kick_off_call",
      order: 1,
      gating: { type: "phase_gate" },
    });
    const implementationSession = makeSession({
      phase: "implementation",
      owner: "is",
      stageKey: "impl_stage_1",
      order: 0,
    });
    const goLive = makeSession({
      phase: "implementation",
      owner: "is",
      stageKey: "impl_stage_2",
      key: "go_live",
      name: "Go-Live",
      order: 0,
      locked: true,
      lockedDate: true,
      date: "2099-04-28",
    });

    const project = makeProject({
      projectStart: "2099-04-22",
      implementationStart: "2099-04-24",
      goLiveDate: "2099-04-28",
      setupSessions: [internalSetup, kickOff],
      implSessions: [],
    });
    project.id = "smartfill-phase-order";
    project.phases.implementation.stages = [
      {
        key: "impl_stage_1",
        label: "Implementation",
        order: 0,
        rangeStart: "",
        rangeEnd: "",
        sessions: [implementationSession],
      },
      {
        key: "impl_stage_2",
        label: "Go-Live",
        order: 1,
        rangeStart: "",
        rangeEnd: "",
        sessions: [goLive],
      },
    ];

    state.projects = [project];
    state.activeProjectId = project.id;
    state.actor = "pm";
    state.ui.smartStart = project.projectStart;
    state.ui.smartPreference = "none";
    state.ui.activeDays = new Set([1, 2, 3, 4, 5]);
    state.calendarAvailability = createCalendarAvailabilityState({
      projectId: project.id,
      rangeStart: "2099-04-21",
      rangeEnd: "2099-04-28",
      sources: {
        pm: { status: "ready", loadedAt: "2099-04-20T00:00:00Z" },
        is: { status: "ready", loadedAt: "2099-04-20T00:00:00Z" },
      },
    });
    state.calendarEvents = [];

    const result = applySmartFill();

    assert.equal(result.unplacedCount, 0);
    assert.equal(internalSetup.date, "2099-04-21");
    assert.equal(kickOff.date, "2099-04-22");
    assert.equal(implementationSession.date, "2099-04-24");
    assert.equal(goLive.date, "2099-04-28");
    assert.ok(internalSetup.date < kickOff.date);
    assert.ok(kickOff.date < implementationSession.date);
    assert.ok(implementationSession.date < goLive.date);
  } finally {
    resetAppState();
  }
});

test("Smart Fill pass two respects owner-specific availability when assigning times", () => {
  resetAppState();

  try {
    const kickOff = makeSession({
      phase: "setup",
      type: "external",
      key: "kick_off_call",
      name: "Kick-Off Call",
      order: 0,
      gating: { type: "phase_gate" },
    });
    const implementationSession = makeSession({
      phase: "implementation",
      owner: "is",
      stageKey: "impl_stage_1",
      key: "workflow",
      name: "Workflow",
      order: 0,
    });

    const project = makeProject({
      projectStart: "2099-04-22",
      implementationStart: "2099-04-24",
      goLiveDate: "2099-04-26",
      setupSessions: [kickOff],
      implSessions: [implementationSession],
    });
    project.id = "smartfill-availability";

    state.projects = [project];
    state.activeProjectId = project.id;
    state.actor = "pm";
    state.ui.smartStart = project.projectStart;
    state.ui.smartPreference = "none";
    state.ui.activeDays = new Set([1, 2, 3, 4, 5]);
    state.calendarAvailability = createCalendarAvailabilityState({
      projectId: project.id,
      rangeStart: "2099-04-22",
      rangeEnd: "2099-04-26",
      sources: {
        pm: { status: "ready", loadedAt: "2099-04-20T00:00:00Z" },
        is: { status: "ready", loadedAt: "2099-04-20T00:00:00Z" },
      },
    });
    state.calendarEvents = [
      {
        id: "pm:busy-am",
        calendarOwner: "pm",
        subject: "PM busy AM",
        start: "2099-04-22T08:30:00",
        end: "2099-04-22T12:00:00",
      },
      {
        id: "is:busy-pm",
        calendarOwner: "is",
        subject: "IS busy PM",
        start: "2099-04-24T12:00:00",
        end: "2099-04-24T17:00:00",
      },
    ];

    const result = applySmartFill();

    assert.equal(result.unplacedCount, 0);
    assert.equal(result.availabilityCount, 0);
    assert.equal(kickOff.date, "2099-04-22");
    assert.equal(kickOff.time, "12:00");
    assert.equal(implementationSession.date, "2099-04-24");
    assert.equal(implementationSession.time, "08:30");
  } finally {
    resetAppState();
  }
});

test("unscheduling a session recomputes the stage date range", () => {
  resetAppState();

  const first = makeSession({ phase: "setup", date: "2099-04-22", order: 0 });
  const second = makeSession({ phase: "setup", date: "2099-04-24", order: 1 });
  const project = makeProject({ setupSessions: [first, second] });
  const stage = project.phases.setup.stages[0];

  project.id = "project-stage-range";
  stage.rangeStart = "2099-04-22";
  stage.rangeEnd = "2099-04-24";

  state.projects = [project];
  state.activeProjectId = project.id;
  state.actor = "pm";

  assert.equal(unscheduleSession(second.id), true);
  assert.equal(stage.rangeStart, "2099-04-22");
  assert.equal(stage.rangeEnd, "2099-04-22");
});
