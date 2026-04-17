import { createOnboardingDraft } from "./projects.js";
import {
  createBlankTemplate,
  normalizeTemplate,
  serializeTemplateLibrarySource,
  validateTemplate,
} from "./session-templates.js";
import { setScreen, state } from "./state.js";

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function ensureMetadata(template) {
  if (!template.metadata || typeof template.metadata !== "object") {
    template.metadata = {};
  }
  return template.metadata;
}

function syncTemplateEditorValidation() {
  const draft = state.ui.templateEditor.draft;
  if (!draft) {
    state.ui.templateEditor.validation = { errors: [], warnings: [] };
    return state.ui.templateEditor.validation;
  }

  const result = validateTemplate(draft);
  state.ui.templateEditor.validation = {
    errors: result.errors,
    warnings: result.warnings,
  };
  return state.ui.templateEditor.validation;
}

function commitDraftToLibrary() {
  if (state.ui.templateEditor.mode !== "library" || !state.ui.templateEditor.draft) return;
  const nextLibrary = state.templateLibrary.slice();
  nextLibrary[state.ui.templateEditor.activeTemplateIndex] = cloneValue(state.ui.templateEditor.draft);
  state.templateLibrary = nextLibrary;
}

function selectTemplateIndex(index) {
  const template = state.templateLibrary[index];
  if (!template) return null;
  state.ui.templateEditor.activeTemplateIndex = index;
  state.ui.templateEditor.draft = cloneValue(template);
  state.ui.templateEditor.originKey = template.key || "";
  syncTemplateEditorValidation();
  return state.ui.templateEditor.draft;
}

function makeUniqueTemplateKey(base = "template") {
  const slug = String(base || "template")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "template";
  const existing = new Set(state.templateLibrary.map((template) => template.key));
  if (!existing.has(slug)) return slug;
  let index = 2;
  while (existing.has(`${slug}_${index}`)) {
    index += 1;
  }
  return `${slug}_${index}`;
}

function updateDraft(mutator, { commit = true } = {}) {
  const draft = state.ui.templateEditor.draft;
  if (!draft) return null;
  mutator(draft);
  state.ui.templateEditor.dirty = true;
  syncTemplateEditorValidation();
  if (commit) {
    commitDraftToLibrary();
  }
  return draft;
}

function getPhaseRef(phaseIndex) {
  return state.ui.templateEditor.draft?.phases?.[phaseIndex] || null;
}

function getStageRef(phaseIndex, stageIndex) {
  return getPhaseRef(phaseIndex)?.stages?.[stageIndex] || null;
}

function getSessionRef(phaseIndex, stageIndex, sessionIndex) {
  return getStageRef(phaseIndex, stageIndex)?.sessions?.[sessionIndex] || null;
}

function normalizeEditableBodyKey(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeEditableNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function preserveOnboardingContext(nextDraft, previousDraft) {
  if (!previousDraft) return nextDraft;
  nextDraft.clientName = previousDraft.clientName;
  nextDraft.pmName = previousDraft.pmName;
  nextDraft.pmEmail = previousDraft.pmEmail;
  nextDraft.isName = previousDraft.isName;
  nextDraft.isEmail = previousDraft.isEmail;
  nextDraft.projectStart = previousDraft.projectStart;
  nextDraft.implementationStart = previousDraft.implementationStart;
  nextDraft.goLiveDate = previousDraft.goLiveDate;
  nextDraft.hypercareDuration = previousDraft.hypercareDuration;
  nextDraft.smartFillPreference = previousDraft.smartFillPreference;
  nextDraft.workingDays = [...previousDraft.workingDays];
  nextDraft.invitees = previousDraft.invitees;
  nextDraft.location = previousDraft.location;
  nextDraft.goLiveSuggestedDate = previousDraft.goLiveSuggestedDate;
  nextDraft.goLiveRecommendedWeeks = previousDraft.goLiveRecommendedWeeks;
  nextDraft.goLiveWarning = previousDraft.goLiveWarning;
  nextDraft.goLiveManuallySet = previousDraft.goLiveManuallySet;
  return nextDraft;
}

export function templateEditorHasUnsavedChanges() {
  return Boolean(state.ui.templateEditor.dirty);
}

export function getTemplateLibraryOptions() {
  return state.templateLibrary.map((template, index) => ({
    key: template.key,
    label: template.label,
    index,
  }));
}

export function getTemplateEditorDraft() {
  return state.ui.templateEditor.draft;
}

export function openTemplateLibraryEditor(index = 0) {
  state.ui.templateEditor = {
    mode: "library",
    activeTemplateIndex: index,
    draft: null,
    originKey: "",
    dirty: false,
    exportSource: "",
    validation: { errors: [], warnings: [] },
    returnScreen: state.ui.screen === "auth" ? "projects" : state.ui.screen,
  };
  selectTemplateIndex(index);
  setScreen("templates");
}

export function openTemplateOneOffEditor({ template = null, originKey = "", returnScreen = "projects" } = {}) {
  const sourceTemplate = template
    ? cloneValue(template)
    : cloneValue(state.templateLibrary.find((candidate) => candidate.key === originKey) || state.templateLibrary[0] || createBlankTemplate());
  state.ui.templateEditor = {
    mode: "oneoff",
    activeTemplateIndex: -1,
    draft: sourceTemplate,
    originKey: originKey || sourceTemplate.key || "custom",
    dirty: false,
    exportSource: "",
    validation: { errors: [], warnings: [] },
    returnScreen,
  };
  syncTemplateEditorValidation();
  setScreen("templates");
}

export function closeTemplateEditor() {
  const returnScreen = state.ui.templateEditor.returnScreen || "projects";
  state.ui.templateEditor = {
    mode: "library",
    activeTemplateIndex: 0,
    draft: null,
    originKey: "",
    dirty: false,
    exportSource: "",
    validation: { errors: [], warnings: [] },
    returnScreen: "projects",
  };
  setScreen(returnScreen);
}

export function selectTemplateEditorTemplate(index) {
  if (state.ui.templateEditor.mode !== "library") return null;
  return selectTemplateIndex(index);
}

export function createTemplateEditorTemplate() {
  if (state.ui.templateEditor.mode !== "library") return null;
  const nextTemplate = createBlankTemplate({
    key: makeUniqueTemplateKey("template"),
    label: "New Template",
    metadata: { version: 1 },
  });
  state.templateLibrary = [...state.templateLibrary, nextTemplate];
  state.ui.templateEditor.dirty = true;
  return selectTemplateIndex(state.templateLibrary.length - 1);
}

export function duplicateTemplateEditorTemplate() {
  const source = state.ui.templateEditor.draft;
  if (!source || state.ui.templateEditor.mode !== "library") return null;
  const nextTemplate = cloneValue(source);
  nextTemplate.key = makeUniqueTemplateKey(`${source.key || "template"}_copy`);
  nextTemplate.label = `${source.label || "Template"} Copy`;
  state.templateLibrary = [...state.templateLibrary, nextTemplate];
  state.ui.templateEditor.dirty = true;
  return selectTemplateIndex(state.templateLibrary.length - 1);
}

export function removeTemplateEditorStage(phaseIndex, stageIndex) {
  updateDraft((draft) => {
    draft.phases[phaseIndex]?.stages?.splice(stageIndex, 1);
  });
}

export function moveTemplateEditorStage(phaseIndex, stageIndex, direction) {
  updateDraft((draft) => {
    const stages = draft.phases[phaseIndex]?.stages || [];
    const targetIndex = stageIndex + direction;
    if (targetIndex < 0 || targetIndex >= stages.length) return;
    const [stage] = stages.splice(stageIndex, 1);
    stages.splice(targetIndex, 0, stage);
  });
}

export function addTemplateEditorStage(phaseIndex) {
  updateDraft((draft) => {
    const phase = draft.phases[phaseIndex];
    if (!phase) return;
    const nextIndex = (phase.stages || []).length + 1;
    phase.stages = phase.stages || [];
    phase.stages.push({
      key: `${phase.key}_stage_${nextIndex}`,
      label: `Stage ${nextIndex}`,
      sessions: [],
    });
  });
}

export function addTemplateEditorSession(phaseIndex, stageIndex) {
  updateDraft((draft) => {
    const stage = draft.phases[phaseIndex]?.stages?.[stageIndex];
    if (!stage) return;
    const nextIndex = (stage.sessions || []).length + 1;
    stage.sessions = stage.sessions || [];
    stage.sessions.push({
      key: `${stage.key}_session_${nextIndex}`,
      name: "New Session",
      durationMinutes: 90,
      type: "external",
      owner: draft.phases[phaseIndex]?.owner || "pm",
      bodyKey: null,
      locked: false,
      gating: null,
    });
  });
}

export function removeTemplateEditorSession(phaseIndex, stageIndex, sessionIndex) {
  updateDraft((draft) => {
    draft.phases[phaseIndex]?.stages?.[stageIndex]?.sessions?.splice(sessionIndex, 1);
  });
}

export function moveTemplateEditorSession(phaseIndex, stageIndex, sessionIndex, direction) {
  updateDraft((draft) => {
    const sessions = draft.phases[phaseIndex]?.stages?.[stageIndex]?.sessions || [];
    const targetIndex = sessionIndex + direction;
    if (targetIndex < 0 || targetIndex >= sessions.length) return;
    const [session] = sessions.splice(sessionIndex, 1);
    sessions.splice(targetIndex, 0, session);
  });
}

export function updateTemplateEditorField(field, value) {
  const parts = String(field || "").split(".");
  if (!parts.length) return;

  updateDraft((draft) => {
    if (parts[0] === "key") {
      draft.key = String(value || "").trim();
      return;
    }
    if (parts[0] === "label") {
      draft.label = String(value || "").trim();
      return;
    }
    if (parts[0] === "metadata") {
      const metadata = ensureMetadata(draft);
      metadata[parts[1]] = String(value || "").trim();
      if (!metadata[parts[1]]) {
        delete metadata[parts[1]];
      }
      return;
    }

    if (parts[0] === "phase") {
      const phase = getPhaseRef(Number(parts[1]));
      if (!phase) return;
      if (parts[2] === "durationWeeks") {
        phase.durationWeeks = phase.durationWeeks || { min: null, max: null };
        phase.durationWeeks[parts[3]] = value === "" ? null : normalizeEditableNumber(value, null);
        return;
      }
      phase[parts[2]] = String(value || "").trim();
      return;
    }

    if (parts[0] === "stage") {
      const stage = getStageRef(Number(parts[1]), Number(parts[2]));
      if (!stage) return;
      stage[parts[3]] = String(value || "").trim();
      return;
    }

    if (parts[0] === "session") {
      const session = getSessionRef(Number(parts[1]), Number(parts[2]), Number(parts[3]));
      if (!session) return;
      const fieldKey = parts[4];
      if (fieldKey === "durationMinutes") {
        session.durationMinutes = normalizeEditableNumber(value, 90);
        return;
      }
      if (fieldKey === "locked") {
        session.locked = Boolean(value === true || value === "true" || value === "on");
        return;
      }
      if (fieldKey === "bodyKey") {
        session.bodyKey = normalizeEditableBodyKey(value);
        return;
      }
      if (fieldKey === "gating") {
        const gatingField = parts[5];
        if (gatingField === "type") {
          if (!value || value === "none") {
            session.gating = null;
            return;
          }
          if (value === "phase_gate") {
            session.gating = { type: "phase_gate" };
            return;
          }
          if (value === "predecessor") {
            session.gating = {
              type: "predecessor",
              ref: session.gating?.ref || "",
            };
          }
          return;
        }
        if (gatingField === "ref") {
          session.gating = {
            type: "predecessor",
            ref: String(value || "").trim(),
          };
          return;
        }
      }
      session[fieldKey] = String(value || "").trim();
    }
  });
}

export function getTemplateEditorPreview() {
  const draft = state.ui.templateEditor.draft;
  if (!draft) return null;
  const normalized = normalizeTemplate(draft);
  return {
    template: normalized,
    phases: normalized.phases.map((phase) => ({
      ...phase,
      totalMinutes: phase.sessions.reduce((total, session) => total + (Number(session.durationMinutes) || 0), 0),
      scheduledSummary:
        phase.stages
          .map((stage) => `${stage.label}: ${stage.sessions.length}`)
          .join(" | "),
    })),
  };
}

export function buildTemplateLibraryExport() {
  if (state.ui.templateEditor.mode === "library") {
    commitDraftToLibrary();
  }
  const errors = [];
  state.templateLibrary.forEach((template) => {
    const validation = validateTemplate(template);
    if (validation.errors.length) {
      errors.push(...validation.errors.map((issue) => `${template.label}: ${issue.message}`));
    }
  });
  if (errors.length) {
    return {
      ok: false,
      source: "",
      errors,
    };
  }

  const source = serializeTemplateLibrarySource(state.templateLibrary);
  state.ui.templateEditor.exportSource = source;
  state.ui.templateEditor.dirty = false;
  return {
    ok: true,
    source,
    errors: [],
  };
}

export function applyOneOffTemplateToOnboarding() {
  const draft = state.ui.templateEditor.draft;
  if (!draft || state.ui.templateEditor.mode !== "oneoff") {
    return { ok: false, errors: ["No one-off template is active."] };
  }

  const validation = validateTemplate(draft);
  if (validation.errors.length) {
    return {
      ok: false,
      errors: validation.errors.map((issue) => issue.message),
    };
  }

  const previousDraft = state.ui.onboarding.draft;
  const nextDraft = createOnboardingDraft(state.ui.templateEditor.originKey || draft.key || "custom", {
    templateSnapshot: cloneValue(draft),
    templateCustomized: true,
    templateOriginKey: state.ui.templateEditor.originKey || draft.key || "custom",
    templateLabel: draft.label,
  });
  preserveOnboardingContext(nextDraft, previousDraft);
  state.ui.onboarding.draft = nextDraft;
  state.ui.onboarding.templateReviewJSON = JSON.stringify(draft, null, 2);
  state.ui.templateEditor.dirty = false;
  return { ok: true, draft: nextDraft };
}
