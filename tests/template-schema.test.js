import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { EXPECTED_TEMPLATE_RUNTIME_PARITY } from "./fixtures/template-runtime-parity.js";
import {
  BUILT_IN_TEMPLATES,
  createBlankTemplate,
  getBuiltInTemplates,
  getTemplateDefinition,
  normalizeEditableTemplate,
  normalizeTemplate,
  normalizeTemplateLibrary,
  serializeTemplateLibrarySource,
  validateTemplate,
} from "../js/session-templates.js";

function projectTemplateRuntimeShape(template) {
  return {
    key: template.key,
    label: template.label,
    phases: template.phases.map((phase) => ({
      key: phase.key,
      label: phase.label,
      owner: phase.owner,
      calendarSource: phase.calendarSource,
      durationWeeks: {
        min: phase.durationWeeks?.min ?? null,
        max: phase.durationWeeks?.max ?? null,
      },
      stages: phase.stages.map((stage) => ({
        key: stage.key,
        label: stage.label,
        durationDays: stage.durationDays,
        sessions: stage.sessions.map((session) => ({
          key: session.key,
          name: session.name,
          durationMinutes: session.durationMinutes,
          owner: session.owner,
          type: session.type,
          locked: Boolean(session.locked),
          gating: session.gating ? { ...session.gating } : null,
          bodyKey: session.bodyKey ?? null,
        })),
      })),
    })),
  };
}

function getPhaseShape(template, phaseKey) {
  return template.phases.find((phase) => phase.key === phaseKey);
}

function getStageShape(phase, stageKey) {
  return phase.stages.find((stage) => stage.key === stageKey);
}

function sessionShapeMap(stage) {
  return new Map((stage.sessions || []).map((session) => [
    session.key,
    {
      key: session.key,
      name: session.name,
      durationMinutes: session.durationMinutes,
      owner: session.owner,
      type: session.type,
      locked: Boolean(session.locked),
      gating: session.gating ? { ...session.gating } : null,
      bodyKey: session.bodyKey ?? null,
    },
  ]));
}

test("normalized built-in templates preserve declarative gating, locking, and routing", () => {
  const manufacturing = getTemplateDefinition("manufacturing");
  const setupSessions = manufacturing.phaseMap.setup.stages[0].sessions;
  const implementationSessions = manufacturing.phaseMap.implementation.stages.flatMap((stage) => stage.sessions);

  assert.equal(setupSessions[2].key, "kick_off_call");
  assert.deepEqual(setupSessions[2].gating, { type: "phase_gate" });
  assert.equal(manufacturing.phaseMap.implementation.calendarSource, "is");
  assert.equal(implementationSessions.find((session) => session.key === "go_live")?.lockedDate, true);
  assert.equal(manufacturing.sessions[0].phaseOrder, 0);
  assert.equal(manufacturing.sessions.at(-1)?.phase, "hypercare");
});

test("validateTemplate reports broken predecessor refs", () => {
  const template = createBlankTemplate({ key: "invalid_template", label: "Invalid Template" });
  template.phases[0].stages.push({
    key: "setup_stage",
    label: "Setup Stage",
    sessions: [
      {
        key: "setup_session",
        name: "Setup Session",
        durationMinutes: 60,
        owner: "pm",
        type: "external",
        bodyKey: null,
        gating: {
          type: "predecessor",
          ref: "missing_session",
        },
      },
    ],
  });

  const result = validateTemplate(template);
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /does not exist/i);
});

test("validateTemplate reports invalid stage durationDays", () => {
  const template = createBlankTemplate({ key: "invalid_duration", label: "Invalid Duration" });
  template.phases[0].stages.push({
    key: "setup_stage",
    label: "Setup Stage",
    durationDays: 0,
    sessions: [],
  });

  const result = validateTemplate(template);
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /durationDays/i);
});

test("editable template normalization defaults missing stage durationDays to 1", () => {
  const template = createBlankTemplate({ key: "editable_default", label: "Editable Default" });
  template.phases[0].stages.push({
    key: "setup_stage",
    label: "Setup Stage",
    sessions: [],
  });

  const normalized = normalizeEditableTemplate(template);
  assert.equal(normalized.phases[0].stages[0].durationDays, 1);
});

test("built-in editable templates load with durationDays populated", () => {
  const templates = getBuiltInTemplates();
  assert.ok(
    templates.every((template) =>
      template.phases.every((phase) =>
        phase.stages.every((stage) => Number.isInteger(stage.durationDays) && stage.durationDays >= 1)
      )
    )
  );
});

test("manufacturing template normalization matches the locked runtime parity snapshot", () => {
  const rawTemplate = BUILT_IN_TEMPLATES.find((template) => template.key === "manufacturing");
  const normalized = normalizeTemplate(rawTemplate);

  assert.deepEqual(
    projectTemplateRuntimeShape(normalized),
    EXPECTED_TEMPLATE_RUNTIME_PARITY.manufacturing
  );
});

test("warehousing template normalization matches the locked runtime parity snapshot", () => {
  const rawTemplate = BUILT_IN_TEMPLATES.find((template) => template.key === "warehousing");
  const normalized = normalizeTemplate(rawTemplate);

  assert.deepEqual(
    projectTemplateRuntimeShape(normalized),
    EXPECTED_TEMPLATE_RUNTIME_PARITY.warehousing
  );
});

test("manufacturing and warehousing built-ins differ only in the documented implementation and hypercare deltas", () => {
  const manufacturing = projectTemplateRuntimeShape(normalizeTemplate(BUILT_IN_TEMPLATES.find((template) => template.key === "manufacturing")));
  const warehousing = projectTemplateRuntimeShape(normalizeTemplate(BUILT_IN_TEMPLATES.find((template) => template.key === "warehousing")));

  assert.deepEqual(getPhaseShape(manufacturing, "setup"), getPhaseShape(warehousing, "setup"));

  const manufacturingImplementation = getPhaseShape(manufacturing, "implementation");
  const warehousingImplementation = getPhaseShape(warehousing, "implementation");
  assert.deepEqual(
    manufacturingImplementation.stages.map((stage) => stage.key),
    warehousingImplementation.stages.map((stage) => stage.key)
  );
  assert.deepEqual(
    getStageShape(manufacturingImplementation, "go_live_prep"),
    getStageShape(warehousingImplementation, "go_live_prep")
  );
  assert.deepEqual(
    getStageShape(manufacturingImplementation, "go_live"),
    getStageShape(warehousingImplementation, "go_live")
  );

  const manufacturingTrainingSessions = sessionShapeMap(getStageShape(manufacturingImplementation, "training"));
  const warehousingTrainingSessions = sessionShapeMap(getStageShape(warehousingImplementation, "training"));
  const manufacturingTrainingKeys = [...manufacturingTrainingSessions.keys()];
  const warehousingTrainingKeys = [...warehousingTrainingSessions.keys()];

  assert.deepEqual(
    manufacturingTrainingKeys.filter((key) => !warehousingTrainingSessions.has(key)),
    ["manufacturing"]
  );
  assert.deepEqual(
    warehousingTrainingKeys.filter((key) => !manufacturingTrainingSessions.has(key)),
    []
  );

  for (const key of warehousingTrainingKeys) {
    const manufacturingSession = manufacturingTrainingSessions.get(key);
    const warehousingSession = warehousingTrainingSessions.get(key);
    assert.ok(manufacturingSession, `Expected manufacturing training stage to include ${key}`);
    if (key === "templates") {
      assert.equal(manufacturingSession.durationMinutes, 240);
      assert.equal(warehousingSession.durationMinutes, 180);
      assert.deepEqual(
        { ...manufacturingSession, durationMinutes: warehousingSession.durationMinutes },
        warehousingSession
      );
      continue;
    }
    if (key === "bill_of_materials") {
      assert.equal(manufacturingSession.durationMinutes, 60);
      assert.equal(warehousingSession.durationMinutes, 30);
      assert.deepEqual(
        { ...manufacturingSession, durationMinutes: warehousingSession.durationMinutes },
        warehousingSession
      );
      continue;
    }
    assert.deepEqual(manufacturingSession, warehousingSession);
  }

  const manufacturingHypercare = getPhaseShape(manufacturing, "hypercare");
  const warehousingHypercare = getPhaseShape(warehousing, "hypercare");
  const manufacturingPostGoLive = sessionShapeMap(getStageShape(manufacturingHypercare, "post_go_live"));
  const warehousingPostGoLive = sessionShapeMap(getStageShape(warehousingHypercare, "post_go_live"));
  const manufacturingHypercareKeys = [...manufacturingPostGoLive.keys()];
  const warehousingHypercareKeys = [...warehousingPostGoLive.keys()];

  assert.deepEqual(
    manufacturingHypercareKeys.filter((key) => !warehousingPostGoLive.has(key)),
    ["training_support_4"]
  );
  assert.deepEqual(
    warehousingHypercareKeys.filter((key) => !manufacturingPostGoLive.has(key)),
    []
  );

  for (const key of warehousingHypercareKeys) {
    assert.deepEqual(manufacturingPostGoLive.get(key), warehousingPostGoLive.get(key));
  }
});

test("serializeTemplateLibrarySource produces a module that round-trips the template library", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "tp-template-export-"));
  const modulePath = path.join(tmpDir, "session-templates.js");
  const schemaPath = path.join(tmpDir, "template-schema.js");
  const bodiesPath = path.join(tmpDir, "session-bodies.js");
  const baseline = normalizeTemplateLibrary(BUILT_IN_TEMPLATES);

  try {
    const source = serializeTemplateLibrarySource(BUILT_IN_TEMPLATES);
    await writeFile(modulePath, source, "utf8");
    await writeFile(schemaPath, await readFile(path.resolve("js/template-schema.js"), "utf8"), "utf8");
    await writeFile(bodiesPath, await readFile(path.resolve("js/session-bodies.js"), "utf8"), "utf8");

    const exported = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
    const roundTripped = normalizeTemplateLibrary(exported.BUILT_IN_TEMPLATES);

    assert.equal(exported.BUILT_IN_TEMPLATES.length, BUILT_IN_TEMPLATES.length);
    assert.deepEqual(roundTripped, baseline);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
