import test from "node:test";
import assert from "node:assert/strict";

import { createCalendarAvailabilityState } from "../js/calendar-sources.js";
import { getConflicts } from "../js/conflicts.js";
import { createOnboardingDraft, createProjectFromDraft, getPhaseStages } from "../js/projects.js";
import { resetAppState, state } from "../js/state.js";

test("conflict detection respects a project's phase-level calendarSource override", () => {
  resetAppState();

  try {
    const draft = createOnboardingDraft("manufacturing");
    draft.clientName = "Calendar Override";
    draft.projectStart = "2026-04-20";
    draft.implementationStart = "2026-04-27";
    draft.goLiveDate = "2026-05-29";

    const project = createProjectFromDraft(draft);
    project.phases.setup.calendarSource = "is";

    const session = getPhaseStages(project, "setup")[0].sessions[0];
    session.date = "2026-04-20";
    session.time = "09:00";

    state.calendarAvailability = createCalendarAvailabilityState({
      projectId: project.id,
      rangeStart: "2026-04-01",
      rangeEnd: "2026-04-30",
      sources: {
        pm: { status: "ready" },
        is: { status: "ready" },
      },
    });
    state.calendarEvents = [
      {
        id: "pm:busy",
        calendarOwner: "pm",
        subject: "PM busy",
        start: "2026-04-20T09:00:00",
        end: "2026-04-20T09:30:00",
      },
      {
        id: "is:busy",
        calendarOwner: "is",
        subject: "IS busy",
        start: "2026-04-20T09:00:00",
        end: "2026-04-20T09:30:00",
      },
    ];

    const conflicts = getConflicts({ project, actor: "pm", scope: "editable" });
    const hits = conflicts.get(session.id) || [];

    assert.deepEqual(
      hits.map((conflict) => conflict.subject),
      ["IS busy"]
    );
  } finally {
    resetAppState();
  }
});
