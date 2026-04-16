import test from "node:test";
import assert from "node:assert/strict";

import {
  isDateWithinPhaseWindow,
  INTERNAL_SETUP_BUFFER_DAYS,
} from "../js/projects.js";

let nextId = 1;

function makeSession(overrides = {}) {
  return {
    id: `test-${nextId++}`,
    key: "test_session",
    name: "Test",
    duration: 90,
    phase: "implementation",
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
  projectStart = "2026-03-01",
  implementationStart = "2026-04-01",
  goLiveDate = "2026-06-01",
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

// --- Empty / null date guard ---

test("empty date string returns true", () => {
  const project = makeProject();
  const session = makeSession({ phase: "implementation" });
  assert.equal(isDateWithinPhaseWindow(project, session, ""), true);
});

// --- Bug scenario: impl session in gap between last setup and implementationStart ---

test("impl session between last setup date and implementationStart is valid", () => {
  const project = makeProject({
    implementationStart: "2026-04-01",
    setupSessions: [makeSession({ phase: "setup", date: "2026-03-28", order: 1 })],
  });
  const session = makeSession({ phase: "implementation" });
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-03-30"), true);
});

// --- No setup sessions: falls back to implementationStart ---

test("impl session before implementationStart is rejected when no setup sessions exist", () => {
  const project = makeProject({ implementationStart: "2026-04-01" });
  const session = makeSession({ phase: "implementation" });
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-03-30"), false);
});

test("impl session on implementationStart is valid when no setup sessions exist", () => {
  const project = makeProject({ implementationStart: "2026-04-01" });
  const session = makeSession({ phase: "implementation" });
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-04-01"), true);
});

// --- Same-day cross-phase is rejected ---

test("impl session on same day as last setup session is rejected", () => {
  const project = makeProject({
    setupSessions: [makeSession({ phase: "setup", date: "2026-04-05", order: 1 })],
  });
  const session = makeSession({ phase: "implementation" });
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-04-05"), false);
});

test("setup session on same day as first impl session is rejected", () => {
  const project = makeProject({
    implSessions: [makeSession({ phase: "implementation", date: "2026-04-10", order: 1 })],
  });
  const session = makeSession({ phase: "setup" });
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-04-10"), false);
});

// --- Setup max: prefers actual impl dates over config ---

test("setup session in gap between implementationStart and first impl date is valid", () => {
  const project = makeProject({
    implementationStart: "2026-04-01",
    implSessions: [makeSession({ phase: "implementation", date: "2026-04-10", order: 1 })],
  });
  const session = makeSession({ phase: "setup" });
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-04-05"), true);
});

test("setup session falls back to config max when no impl sessions scheduled", () => {
  const project = makeProject({ implementationStart: "2026-04-01" });
  const session = makeSession({ phase: "setup" });
  // implementationStart - 1 = 2026-03-31 is the max
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-03-31"), true);
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-04-01"), false);
});

// --- External boundaries preserved ---

test("impl session after goLiveDate is rejected", () => {
  const project = makeProject({ goLiveDate: "2026-06-01" });
  const session = makeSession({ phase: "implementation" });
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-06-02"), false);
});

test("setup session before projectStart is rejected", () => {
  const project = makeProject({ projectStart: "2026-03-01" });
  const session = makeSession({ phase: "setup" });
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-02-28"), false);
});

// --- Hypercare ---

test("hypercare session in gap between last impl date and goLiveDate+1 is valid", () => {
  const project = makeProject({
    goLiveDate: "2026-06-01",
    implSessions: [makeSession({ phase: "implementation", date: "2026-05-20", order: 1 })],
  });
  const session = makeSession({ phase: "hypercare" });
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-05-25"), true);
});

test("hypercare session on same day as last impl session is rejected", () => {
  const project = makeProject({
    goLiveDate: "2026-06-01",
    implSessions: [makeSession({ phase: "implementation", date: "2026-05-20", order: 1 })],
  });
  const session = makeSession({ phase: "hypercare" });
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-05-20"), false);
});

test("hypercare session falls back to config min when no impl sessions scheduled", () => {
  const project = makeProject({ goLiveDate: "2026-06-01" });
  const session = makeSession({ phase: "hypercare" });
  // goLiveDate + 1 = 2026-06-02 is the min
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-06-01"), false);
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-06-02"), true);
});

test("hypercare session after max window is rejected", () => {
  const project = makeProject({ goLiveDate: "2026-06-01", hypercareDuration: "1 week" });
  const session = makeSession({ phase: "hypercare" });
  // max = goLiveDate + 1 + 6 = 2026-06-08
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-06-08"), true);
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-06-09"), false);
});

// --- Internal setup buffer preserved ---

test("internal setup session before kickoff can use buffer before projectStart", () => {
  const project = makeProject({ projectStart: "2026-03-15" });
  const session = makeSession({
    phase: "setup",
    type: "internal",
    order: 0,
    key: "pre_kickoff_task",
  });
  // The stage needs a kick_off_call session with a higher order for the buffer to apply
  project.phases.setup.stages[0].sessions = [
    session,
    makeSession({ phase: "setup", key: "kick_off_call", order: 5 }),
  ];
  // Should be able to go INTERNAL_SETUP_BUFFER_DAYS before projectStart
  // 2026-03-15 minus 10 days = 2026-03-05
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-03-05"), true);
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-03-04"), false);
});
