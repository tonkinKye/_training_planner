import test from "node:test";
import assert from "node:assert/strict";

import { unscheduleSession, validateSessionDateChange } from "../js/scheduler.js";
import { resetAppState, state } from "../js/state.js";

let nextId = 1;

function makeSession(overrides = {}) {
  return {
    id: `scheduler-test-${nextId++}`,
    key: "test_session",
    name: "Test",
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
