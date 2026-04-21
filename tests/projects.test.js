import test from "node:test";
import assert from "node:assert/strict";

import {
  canEditSession,
  deriveProjectStatus,
  isDateWithinPhaseWindow,
  INTERNAL_SETUP_BUFFER_DAYS,
  projectReadyToClose,
  removeSession,
} from "../js/projects.js";

let nextId = 1;

function makeSession(overrides = {}) {
  return {
    id: `test-${nextId++}`,
    key: "test_session",
    name: "Test",
    durationMinutes: 90,
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

// --- Setup min expands when internal sessions are scheduled before projectStart ---

test("external setup session can move to date of internal session scheduled before projectStart", () => {
  // Scenario: Smart Fill placed an internal session (Sales Handover) on Tuesday
  // before projectStart (Wednesday) using the buffer. User should be able to
  // move an external session (Installation) to Tuesday as well.
  const project = makeProject({ projectStart: "2026-04-22", implementationStart: "2026-05-20" }); // Wednesday
  const internalSession = makeSession({
    phase: "setup",
    type: "internal",
    key: "sales_handover",
    order: 0,
    date: "2026-04-21", // Tuesday — placed before projectStart via buffer
  });
  const externalSession = makeSession({
    phase: "setup",
    type: "external",
    key: "installation",
    order: 1,
    date: "2026-04-22", // Wednesday — currently at projectStart
  });
  const kickOff = makeSession({
    phase: "setup",
    type: "external",
    key: "kick_off_call",
    order: 2,
    date: "2026-04-22",
  });
  project.phases.setup.stages[0].sessions = [internalSession, externalSession, kickOff];

  // Moving Installation to Tuesday (where Sales Handover already is) should be valid
  assert.equal(isDateWithinPhaseWindow(project, externalSession, "2026-04-21"), true);
  // Moving it to Monday (before any scheduled session) should still be rejected
  assert.equal(isDateWithinPhaseWindow(project, externalSession, "2026-04-20"), false);
});

test("setup min stays at projectStart when no session is scheduled earlier", () => {
  const project = makeProject({ projectStart: "2026-04-22", implementationStart: "2026-05-20" });
  const session = makeSession({ phase: "setup", type: "external", date: "2026-04-23" });
  project.phases.setup.stages[0].sessions = [session];
  // Can't go before projectStart since no session is scheduled there
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-04-21"), false);
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-04-22"), true);
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
    makeSession({ phase: "setup", key: "kick_off_call", order: 5, gating: { type: "phase_gate" } }),
  ];
  // Should be able to go INTERNAL_SETUP_BUFFER_DAYS before projectStart
  // 2026-03-15 minus 10 days = 2026-03-05
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-03-05"), true);
  assert.equal(isDateWithinPhaseWindow(project, session, "2026-03-04"), false);
});

test("removing a session recomputes the stage date range", () => {
  const first = makeSession({ phase: "setup", date: "2026-04-22", order: 0 });
  const second = makeSession({ phase: "setup", date: "2026-04-24", order: 1 });
  const project = makeProject({ setupSessions: [first, second] });
  const stage = project.phases.setup.stages[0];

  stage.rangeStart = "2026-04-22";
  stage.rangeEnd = "2026-04-24";

  removeSession(project, second.id);
  assert.equal(stage.rangeStart, "2026-04-22");
  assert.equal(stage.rangeEnd, "2026-04-22");

  removeSession(project, first.id);
  assert.equal(stage.rangeStart, "");
  assert.equal(stage.rangeEnd, "");
});

test("project lifecycle status advances from draft through closed", () => {
  const draftProject = makeProject({
    implSessions: [makeSession({ phase: "implementation", date: "", time: "" })],
  });
  assert.equal(deriveProjectStatus(draftProject), "draft");

  const scheduledProject = makeProject({
    implSessions: [makeSession({ phase: "implementation", date: "2026-04-10", time: "09:00" })],
  });
  assert.equal(deriveProjectStatus(scheduledProject), "pm_scheduled");

  const handedOffProject = makeProject({
    implSessions: [makeSession({ phase: "implementation", date: "2026-04-10", time: "09:00" })],
  });
  handedOffProject.handoff = { sentAt: "2026-04-01T00:00:00Z" };
  assert.equal(deriveProjectStatus(handedOffProject), "handed_off_pending_is");

  const activeProject = makeProject({
    implSessions: [makeSession({ phase: "implementation", date: "2026-04-10", time: "09:00", graphEventId: "evt-1" })],
  });
  activeProject.handoff = { sentAt: "2026-04-01T00:00:00Z" };
  assert.equal(deriveProjectStatus(activeProject), "is_active");

  activeProject.closedAt = "2026-04-15T00:00:00Z";
  assert.equal(deriveProjectStatus(activeProject), "closed");
});

test("project ready-to-close requires in-sync reconciliation and past sessions", () => {
  const project = makeProject({
    setupSessions: [makeSession({ phase: "setup", date: "2026-04-01", time: "09:00" })],
    implSessions: [makeSession({ phase: "implementation", date: "2026-04-10", time: "09:00", graphEventId: "evt-1" })],
    hcSessions: [makeSession({ phase: "hypercare", date: "2026-04-17", time: "09:00" })],
  });
  project.handoff = { sentAt: "2026-03-15T00:00:00Z" };
  project.reconciliationState = "refresh_failed";

  assert.equal(projectReadyToClose(project, new Date("2026-04-20T10:00:00")), false);

  project.reconciliationState = "in_sync";
  assert.equal(projectReadyToClose(project, new Date("2026-04-20T10:00:00")), true);

  project.phases.hypercare.stages[0].sessions[0].date = "2026-04-21";
  assert.equal(projectReadyToClose(project, new Date("2026-04-20T10:00:00")), false);
});

test("PM cannot edit implementation sessions after handoff leaves pm_scheduled", () => {
  const implementationSession = makeSession({ phase: "implementation", date: "2026-04-10", time: "09:00" });
  const setupSession = makeSession({ phase: "setup", date: "2026-04-01", time: "09:00" });
  const project = makeProject({
    setupSessions: [setupSession],
    implSessions: [implementationSession],
  });

  assert.equal(canEditSession(project, implementationSession, "pm"), true);
  assert.equal(canEditSession(project, setupSession, "pm"), true);

  project.handoff = { sentAt: "2026-04-01T00:00:00Z" };
  assert.equal(canEditSession(project, implementationSession, "pm"), false);
  assert.equal(canEditSession(project, setupSession, "pm"), true);
});
