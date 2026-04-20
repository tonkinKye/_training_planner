import test from "node:test";
import assert from "node:assert/strict";

import { createOnboardingDraft, createProjectFromDraft, getPhaseStages } from "../js/projects.js";
import { createBlankTemplate } from "../js/session-templates.js";
import { buildRenderSnapshot, getKanbanColumns, getPhaseSectionKey, getStageSectionKey, getTemplatePhaseTimelineLayout, updateRenderSlot } from "../js/render.js";
import { state } from "../js/state.js";
import { fmtDur } from "../js/utils.js";

test("render slot updater skips rewriting unchanged markup", () => {
  const slot = {
    innerHTML: "",
    dataset: {},
    contains() {
      return false;
    },
  };

  assert.equal(updateRenderSlot(slot, "<section>first</section>"), true);
  assert.equal(slot.innerHTML, "<section>first</section>");
  assert.equal(slot.dataset.renderHtml, "<section>first</section>");

  assert.equal(updateRenderSlot(slot, "<section>first</section>"), false);
  assert.equal(slot.innerHTML, "<section>first</section>");

  assert.equal(updateRenderSlot(slot, "<section>second</section>"), true);
  assert.equal(slot.innerHTML, "<section>second</section>");
  assert.equal(slot.dataset.renderHtml, "<section>second</section>");
});

test("workspace phase and stage panels are collapsed by default and expose summary metadata", () => {
  const originalState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    actor: state.actor,
    screen: state.ui.screen,
    expandedPhaseSections: state.ui.expandedPhaseSections,
    expandedStageSections: state.ui.expandedStageSections,
  };

  try {
    const draft = createOnboardingDraft("manufacturing");
    draft.clientName = "Acciona 3";
    draft.pmName = "Kye Tonkin";
    draft.pmEmail = "kye@example.com";
    draft.isName = "Jordan Smith";
    draft.isEmail = "jordan@example.com";
    draft.projectStart = "2026-04-20";
    draft.implementationStart = "2026-04-27";
    draft.goLiveDate = "2026-05-29";

    const project = createProjectFromDraft(draft);
    const setupStage = getPhaseStages(project, "setup")[0];
    setupStage.sessions[0].date = "2026-04-20";
    setupStage.sessions[0].time = "09:00";
    setupStage.sessions[1].date = "2026-04-21";
    setupStage.sessions[1].time = "13:30";
    const setupSessions = getPhaseStages(project, "setup").flatMap((stage) => stage.sessions || []);

    state.projects = [project];
    state.activeProjectId = project.id;
    state.actor = "pm";
    state.ui.screen = "workspace";
    state.ui.expandedPhaseSections = new Set();
    state.ui.expandedStageSections = new Set();

    const expectedStageDuration = fmtDur((setupStage.sessions || []).reduce((total, session) => total + session.duration, 0));
    const expectedSetupScheduled = `${setupSessions.filter((session) => session.date && session.time).length} / ${setupSessions.length}`;
    const expandedSessionField = `data-action="setSessionDate" data-id="${setupStage.sessions[0].id}"`;

    let snapshot = buildRenderSnapshot();
    assert.ok(snapshot.main.includes('data-action="togglePhaseSection"'));
    assert.ok(snapshot.main.includes("Kye Tonkin"));
    assert.ok(snapshot.main.includes(expectedSetupScheduled));
    assert.ok(!snapshot.main.includes(expandedSessionField));

    state.ui.expandedPhaseSections = new Set([getPhaseSectionKey(project.id, "setup")]);
    snapshot = buildRenderSnapshot();
    assert.ok(snapshot.main.includes('data-action="toggleStageSection"'));
    assert.ok(snapshot.main.includes("Kick-Off &amp; Data Prep"));
    assert.ok(snapshot.main.includes(expectedStageDuration));
    assert.ok(!snapshot.main.includes(expandedSessionField));

    state.ui.expandedStageSections = new Set([getStageSectionKey(project.id, "setup", setupStage.key)]);
    snapshot = buildRenderSnapshot();
    assert.ok(snapshot.main.includes(expandedSessionField));
  } finally {
    state.projects = originalState.projects;
    state.activeProjectId = originalState.activeProjectId;
    state.actor = originalState.actor;
    state.ui.screen = originalState.screen;
    state.ui.expandedPhaseSections = originalState.expandedPhaseSections;
    state.ui.expandedStageSections = originalState.expandedStageSections;
  }
});

test("kanban columns come from custom implementation stages instead of hardcoded keys", () => {
  const rawTemplate = createBlankTemplate({ key: "custom_board", label: "Custom Board" });
  rawTemplate.phases[1].stages = [
    {
      key: "discovery",
      label: "Discovery",
      sessions: [
        {
          key: "discovery_session",
          name: "Discovery Session",
          durationMinutes: 60,
          owner: "is",
          type: "external",
          bodyKey: null,
        },
      ],
    },
    {
      key: "build",
      label: "Build",
      sessions: [
        {
          key: "build_session",
          name: "Build Session",
          durationMinutes: 90,
          owner: "is",
          type: "external",
          bodyKey: null,
        },
      ],
    },
    {
      key: "launch_pad",
      label: "Launch Pad",
      sessions: [
        {
          key: "launch_session",
          name: "Launch Session",
          durationMinutes: 120,
          owner: "is",
          type: "external",
          bodyKey: null,
          locked: true,
        },
      ],
    },
  ];

  const draft = createOnboardingDraft("custom_board", {
    templateSnapshot: rawTemplate,
    templateCustomized: true,
    templateOriginKey: "custom_board",
    templateLabel: rawTemplate.label,
  });
  const project = createProjectFromDraft(draft);

  assert.deepEqual(
    getKanbanColumns([project]).map((column) => ({ key: column.key, label: column.label })),
    [
      { key: "scheduling", label: "Scheduling" },
      { key: "setup", label: "Setup" },
      { key: "discovery", label: "Discovery" },
      { key: "build", label: "Build" },
      { key: "launch_pad", label: "Launch Pad" },
      { key: "hypercare", label: "Hypercare" },
    ]
  );
});

test("built-in manufacturing template preserves the existing kanban column sequence", () => {
  const draft = createOnboardingDraft("manufacturing");
  const project = createProjectFromDraft(draft);

  assert.deepEqual(
    getKanbanColumns([project]).map((column) => ({ key: column.key, label: column.label })),
    [
      { key: "scheduling", label: "Scheduling" },
      { key: "setup", label: "Setup" },
      { key: "training", label: "Training" },
      { key: "go_live_prep", label: "Go-Live Prep" },
      { key: "go_live", label: "Go-Live" },
      { key: "hypercare", label: "Hypercare" },
    ]
  );
});

test("template timeline layout uses the fixed weekly scale and stage width clamps", () => {
  const layout = getTemplatePhaseTimelineLayout({
    durationWeeks: { min: 3, max: 3 },
    stages: [
      { durationDays: 1 },
      { durationDays: 5 },
    ],
  });

  assert.equal(layout.phaseWeeks, 3);
  assert.equal(layout.phaseBaseWidth, 320);
  assert.deepEqual(layout.stageLayouts.map((stage) => stage.stageDays), [1, 5]);
  assert.deepEqual(layout.stageLayouts.map((stage) => stage.width), [180, 267]);
  assert.equal(layout.phaseWidth, 501);
});
