import test from "node:test";
import assert from "node:assert/strict";

import { createOnboardingDraft } from "../js/projects.js";
import { buildRenderSnapshot } from "../js/render.js";
import { resetAppState, state } from "../js/state.js";
import {
  addTemplateEditorSession,
  addTemplateEditorStage,
  applyOneOffTemplateToOnboarding,
  buildTemplateLibraryExport,
  createTemplateEditorTemplate,
  moveTemplateEditorSessionToTarget,
  moveTemplateEditorStageToIndex,
  openTemplateLibraryEditor,
  openTemplateOneOffEditor,
  selectTemplateEditorEntity,
  templateEditorHasUnsavedChanges,
  updateTemplateEditorField,
} from "../js/template-editor.js";

test("template editor can build a new template and export the library source", () => {
  resetAppState();
  openTemplateLibraryEditor();
  createTemplateEditorTemplate();

  updateTemplateEditorField("key", "qa_template");
  updateTemplateEditorField("label", "QA Template");
  addTemplateEditorStage(0);
  updateTemplateEditorField("stage.0.0.key", "qa_setup");
  updateTemplateEditorField("stage.0.0.label", "QA Setup");
  updateTemplateEditorField("stage.0.0.durationDays", "3");
  addTemplateEditorSession(0, 0);
  updateTemplateEditorField("session.0.0.0.key", "qa_kickoff");
  updateTemplateEditorField("session.0.0.0.name", "QA Kick-Off");
  updateTemplateEditorField("session.0.0.0.gating.type", "phase_gate");

  assert.equal(templateEditorHasUnsavedChanges(), true);

  const exportResult = buildTemplateLibraryExport();
  assert.equal(exportResult.ok, true);
  assert.match(exportResult.source, /QA Template/);
  assert.match(exportResult.source, /qa_kickoff/);
  assert.match(exportResult.source, /durationDays: 3/);
  assert.equal(templateEditorHasUnsavedChanges(), false);
});

test("one-off template application stores a customized snapshot on the onboarding draft", () => {
  resetAppState();
  state.ui.onboarding.draft = createOnboardingDraft("manufacturing", {
    templateSnapshot: state.templateLibrary.find((template) => template.key === "manufacturing"),
  });
  openTemplateOneOffEditor({
    template: state.templateLibrary.find((template) => template.key === "manufacturing"),
    originKey: "manufacturing",
    returnScreen: "projects",
  });

  updateTemplateEditorField("label", "Manufacturing One-Off");
  updateTemplateEditorField("session.0.0.0.name", "Sales Handover Custom");

  const result = applyOneOffTemplateToOnboarding();
  assert.equal(result.ok, true);
  assert.equal(state.ui.onboarding.draft.templateCustomized, true);
  assert.equal(state.ui.onboarding.draft.templateOriginKey, "manufacturing");
  assert.match(state.ui.onboarding.draft.templateKey, /^oneoff_/);
  assert.equal(state.ui.onboarding.draft.templateSnapshot.label, "Manufacturing One-Off");
  assert.equal(state.ui.onboarding.draft.templateSnapshot.phases[0].stages[0].sessions[0].name, "Sales Handover Custom");
});

test("templates screen renders the graph builder and inspector", () => {
  resetAppState();
  openTemplateLibraryEditor();
  const snapshot = buildRenderSnapshot();

  assert.ok(snapshot.main.includes("Template Library"));
  assert.ok(snapshot.main.includes('data-template-graph'));
  assert.ok(snapshot.main.includes('data-template-graph-scroll'));
  assert.ok(snapshot.main.includes("Inspector"));
  assert.ok(snapshot.main.includes('data-bind="templateEditor.key"'));
  assert.ok(snapshot.main.indexOf('data-template-phase="setup"') < snapshot.main.indexOf('data-template-phase="implementation"'));
  assert.ok(snapshot.main.indexOf('data-template-phase="implementation"') < snapshot.main.indexOf('data-template-phase="hypercare"'));
});

test("template graph renders custom stages and session cards", () => {
  resetAppState();
  openTemplateLibraryEditor();
  createTemplateEditorTemplate();

  updateTemplateEditorField("label", "Graph Template");
  addTemplateEditorStage(0);
  updateTemplateEditorField("stage.0.0.label", "Discovery");
  updateTemplateEditorField("stage.0.0.durationDays", "4");
  addTemplateEditorSession(0, 0);
  updateTemplateEditorField("session.0.0.0.name", "Discovery Workshop");

  const snapshot = buildRenderSnapshot();
  assert.ok(snapshot.main.includes("Discovery"));
  assert.ok(snapshot.main.includes("Discovery Workshop"));
  assert.ok(snapshot.main.includes('data-template-stage-days="4"'));
  assert.ok(snapshot.main.includes('data-template-phase-base-width="320"'));
});

test("selection drives the template inspector", () => {
  resetAppState();
  openTemplateLibraryEditor();
  selectTemplateEditorEntity("session", 0, 0, 0);

  const snapshot = buildRenderSnapshot();
  assert.ok(snapshot.main.includes("Sales Handover"));
  assert.ok(snapshot.main.includes('data-bind="templateEditor.session.0.0.0.durationMinutes"'));
});

test("template editor can reorder stages and move sessions between stages", () => {
  resetAppState();
  openTemplateLibraryEditor();
  createTemplateEditorTemplate();

  addTemplateEditorStage(1);
  updateTemplateEditorField("stage.1.0.label", "Stage A");
  addTemplateEditorSession(1, 0);
  updateTemplateEditorField("session.1.0.0.name", "Session A");

  addTemplateEditorStage(1);
  updateTemplateEditorField("stage.1.1.label", "Stage B");
  addTemplateEditorSession(1, 1);
  updateTemplateEditorField("session.1.1.0.name", "Session B");

  moveTemplateEditorStageToIndex(1, 0, 1, 2);
  moveTemplateEditorSessionToTarget(1, 1, 0, 1, 0, 1);

  const implementationStages = state.ui.templateEditor.draft.phases[1].stages;
  assert.deepEqual(implementationStages.map((stage) => stage.label), ["Stage B", "Stage A"]);
  assert.deepEqual(implementationStages[0].sessions.map((session) => session.name), ["Session B", "Session A"]);
});

test("template editor rejects cross-phase session moves", () => {
  resetAppState();
  openTemplateLibraryEditor();
  createTemplateEditorTemplate();

  addTemplateEditorStage(0);
  updateTemplateEditorField("stage.0.0.label", "Setup Stage");
  addTemplateEditorSession(0, 0);
  updateTemplateEditorField("session.0.0.0.name", "Setup Session");

  addTemplateEditorStage(1);
  updateTemplateEditorField("stage.1.0.label", "Implementation Stage");

  moveTemplateEditorSessionToTarget(0, 0, 0, 1, 0, 0);

  assert.deepEqual(state.ui.templateEditor.draft.phases[0].stages[0].sessions.map((session) => session.name), ["Setup Session"]);
  assert.deepEqual(state.ui.templateEditor.draft.phases[1].stages[0].sessions.map((session) => session.name), []);
});

test("template graph renders inline gate badges without connector markup", () => {
  resetAppState();
  openTemplateLibraryEditor();
  createTemplateEditorTemplate();

  addTemplateEditorStage(0);
  updateTemplateEditorField("stage.0.0.label", "Setup Lane");
  addTemplateEditorSession(0, 0);
  updateTemplateEditorField("session.0.0.0.key", "kickoff");
  updateTemplateEditorField("session.0.0.0.name", "Kickoff");
  updateTemplateEditorField("session.0.0.0.gating.type", "phase_gate");
  addTemplateEditorSession(0, 0);
  updateTemplateEditorField("session.0.0.1.key", "follow_up");
  updateTemplateEditorField("session.0.0.1.name", "Follow Up");
  updateTemplateEditorField("session.0.0.1.gating.type", "predecessor");
  updateTemplateEditorField("session.0.0.1.gating.ref", "kickoff");

  const snapshot = buildRenderSnapshot();
  assert.ok(snapshot.main.includes(">Gate</span>"));
  assert.ok(!snapshot.main.includes("Depends On"));
  assert.ok(!snapshot.main.includes("data-template-phase-rail"));
  assert.ok(!snapshot.main.includes("data-template-edge-from"));
});
