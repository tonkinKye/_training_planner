import test from "node:test";
import assert from "node:assert/strict";

import { createProjectFromDraft, createOnboardingDraft, getPhaseStages } from "../js/projects.js";
import { createSentinelPayload, parseSentinelProjects } from "../js/sentinel-model.js";

function makeProject() {
  const draft = createOnboardingDraft("manufacturing");
  draft.clientName = "Client";
  draft.pmName = "PM";
  draft.pmEmail = "pm@example.com";
  draft.isName = "IS";
  draft.isEmail = "is@example.com";
  draft.projectStart = "2099-04-01";
  draft.implementationStart = "2099-05-01";
  draft.goLiveDate = "2099-06-01";
  return createProjectFromDraft(draft);
}

test("legacy v1 sentinel payloads still inflate into runtime projects with derived lifecycle state", () => {
  const project = makeProject();
  const implementationStage = getPhaseStages(project, "implementation")[0];
  implementationStage.sessions[0].date = "2099-05-10";
  implementationStage.sessions[0].time = "09:00";
  project.handoff.sentAt = "2099-05-01T00:00:00.000Z";

  const projects = parseSentinelProjects({
    payload: JSON.stringify({
      version: 1,
      updatedAt: "2099-05-01T00:00:00.000Z",
      projects: [project],
    }),
  });

  assert.equal(projects.length, 1);
  assert.equal(projects[0].clientName, "Client");
  assert.equal(projects[0].lifecycleState, "handed_off_pending_is");
  assert.equal(projects[0].reconciliationState, "not_applicable");
});

test("v2 sentinel payloads preserve explicit lifecycle and reconciliation metadata", () => {
  const project = makeProject();
  const implementationStage = getPhaseStages(project, "implementation")[0];
  implementationStage.sessions[0].graphEventId = "evt-1";
  implementationStage.sessions[0].graphActioned = true;
  implementationStage.sessions[0].lastKnownStart = "2099-05-12T09:00:00.000Z";
  implementationStage.sessions[0].lastKnownEnd = "2099-05-12T10:30:00.000Z";
  project.handoff.sentAt = "2099-05-10T00:00:00.000Z";
  project.lifecycleState = "is_active";
  project.reconciliationState = "drift_detected";
  project.reconciliation = {
    state: "drift_detected",
    lastAttemptedAt: "2099-05-12T00:00:00.000Z",
    lastSuccessfulAt: "2099-05-12T00:00:00.000Z",
    lastFailureAt: "",
    lastFailureMessage: "",
  };

  const payload = createSentinelPayload([project]);
  const parsed = parseSentinelProjects(payload);

  assert.equal(payload.version, 2);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].lifecycleState, "is_active");
  assert.equal(parsed[0].reconciliationState, "drift_detected");
  assert.equal(parsed[0].reconciliation.lastSuccessfulAt, "2099-05-12T00:00:00.000Z");
});

test("PM handed-off sentinel writes keep implementation identity but drop execution fields", () => {
  const project = makeProject();
  const implementationStage = getPhaseStages(project, "implementation")[0];
  implementationStage.sessions[0].date = "2099-05-10";
  implementationStage.sessions[0].time = "09:00";
  implementationStage.sessions[0].graphEventId = "evt-1";
  implementationStage.sessions[0].graphActioned = true;
  implementationStage.sessions[0].lastKnownStart = "2099-05-10T09:00:00";
  implementationStage.sessions[0].lastKnownEnd = "2099-05-10T10:30:00";
  project.handoff.sentAt = "2099-05-01T00:00:00.000Z";
  project.reconciliationState = "in_sync";
  project.reconciliation = {
    state: "in_sync",
    lastAttemptedAt: "2099-05-12T00:00:00.000Z",
    lastSuccessfulAt: "2099-05-12T00:00:00.000Z",
    lastFailureAt: "",
    lastFailureMessage: "",
  };

  const payload = createSentinelPayload([project], { mailbox: "pm@example.com" });
  const record = payload.projects[0];

  assert.equal(record.phases.implementation.stages[0].sessions[0].id, implementationStage.sessions[0].id);
  assert.equal(record.phases.implementation.stages[0].sessions[0].date, "");
  assert.equal(record.phases.implementation.stages[0].sessions[0].time, "");
  assert.equal(record.phases.implementation.stages[0].sessions[0].graphEventId, "");
  assert.equal(record.phases.implementation.stages[0].sessions[0].lastKnownStart, "");
  assert.equal(record.phases.implementation.stages[0].sessions[0].lastKnownEnd, "");
  assert.equal(record.reconciliationState, "in_sync");
});
