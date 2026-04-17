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
  getTemplateDefinition,
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
