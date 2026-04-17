import test from "node:test";
import assert from "node:assert/strict";

import { decodeProjectParam, encodeProjectParam } from "../js/deeplink.js";
import { createOnboardingDraft, createProjectFromDraft, getPhaseStages } from "../js/projects.js";
import { resetAppState, state } from "../js/state.js";

test("customized template snapshots round-trip through deeplink payloads", () => {
  resetAppState();
  const rawTemplate = structuredClone(state.templateLibrary.find((template) => template.key === "manufacturing"));
  rawTemplate.label = "Manufacturing Custom";
  rawTemplate.phases[1].stages[0].label = "Implementation Custom";

  const draft = createOnboardingDraft("manufacturing", {
    templateSnapshot: rawTemplate,
    templateCustomized: true,
    templateOriginKey: "manufacturing",
    templateLabel: rawTemplate.label,
  });
  draft.clientName = "Acciona 3";
  draft.pmName = "Kye";
  draft.pmEmail = "kye@example.com";
  draft.isName = "Jordan";
  draft.isEmail = "jordan@example.com";
  draft.projectStart = "2026-04-20";
  draft.implementationStart = "2026-04-27";
  draft.goLiveDate = "2026-05-29";

  const project = createProjectFromDraft(draft);
  const implementationStage = getPhaseStages(project, "implementation")[0];
  implementationStage.sessions[0].date = "2026-04-27";
  implementationStage.sessions[0].time = "09:00";

  const { encoded } = encodeProjectParam(project);
  const decoded = decodeProjectParam(encoded);

  assert.equal(decoded.templateCustomized, true);
  assert.equal(decoded.templateOriginKey, "manufacturing");
  assert.equal(decoded.templateSnapshot.label, "Manufacturing Custom");
  assert.equal(decoded.impl[0].label, "Implementation Custom");
});
