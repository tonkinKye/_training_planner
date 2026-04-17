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
  openTemplateLibraryEditor,
  openTemplateOneOffEditor,
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
  addTemplateEditorSession(0, 0);
  updateTemplateEditorField("session.0.0.0.key", "qa_kickoff");
  updateTemplateEditorField("session.0.0.0.name", "QA Kick-Off");
  updateTemplateEditorField("session.0.0.0.gating.type", "phase_gate");

  assert.equal(templateEditorHasUnsavedChanges(), true);

  const exportResult = buildTemplateLibraryExport();
  assert.equal(exportResult.ok, true);
  assert.match(exportResult.source, /QA Template/);
  assert.match(exportResult.source, /qa_kickoff/);
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

test("templates screen renders the editor form and export affordance", () => {
  resetAppState();
  openTemplateLibraryEditor();
  const snapshot = buildRenderSnapshot();

  assert.ok(snapshot.main.includes("Template Library"));
  assert.ok(snapshot.main.includes("Export session-templates.js"));
  assert.ok(snapshot.main.includes('data-bind="templateEditor.key"'));
});
