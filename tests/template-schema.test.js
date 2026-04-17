import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  BUILT_IN_TEMPLATES,
  createBlankTemplate,
  getTemplateDefinition,
  serializeTemplateLibrarySource,
  validateTemplate,
} from "../js/session-templates.js";

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

test("serializeTemplateLibrarySource produces a module that round-trips the template library", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "tp-template-export-"));
  const modulePath = path.join(tmpDir, "session-templates.js");
  const schemaPath = path.join(tmpDir, "template-schema.js");
  const bodiesPath = path.join(tmpDir, "session-bodies.js");

  try {
    const source = serializeTemplateLibrarySource(BUILT_IN_TEMPLATES);
    await writeFile(modulePath, source, "utf8");
    await writeFile(schemaPath, await readFile(path.resolve("js/template-schema.js"), "utf8"), "utf8");
    await writeFile(bodiesPath, await readFile(path.resolve("js/session-bodies.js"), "utf8"), "utf8");

    const exported = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);

    assert.equal(exported.BUILT_IN_TEMPLATES.length, BUILT_IN_TEMPLATES.length);
    assert.equal(exported.getTemplateDefinition("manufacturing").phaseMap.setup.label, "Setup");
    assert.equal(exported.getTemplateDefinition("manufacturing").sessionMap.go_live.lockedDate, true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
