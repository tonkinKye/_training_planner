import { getTemplateDefinition, getTemplateLabel, getTemplateOptions } from "./session-templates.js";
import { parseDate, toDateStr } from "./utils.js";
import { uid } from "./state.js";
import { getCalendarOwnerForPhase as getPhaseCalendarOwner } from "./calendar-sources.js";

export const PHASE_ORDER = ["setup", "implementation", "hypercare"];
export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];
export const INTERNAL_SETUP_BUFFER_DAYS = 10;

export const PHASE_META = {
  setup: {
    label: "Setup",
    owner: "pm",
    ownerLabel: "PM",
    colorVar: "--phase-setup",
  },
  implementation: {
    label: "Implementation",
    owner: "is",
    ownerLabel: "IS",
    colorVar: "--phase-implementation",
  },
  hypercare: {
    label: "Hypercare",
    owner: "pm",
    ownerLabel: "PM",
    colorVar: "--phase-hypercare",
  },
};

export const PROJECT_TYPE_META = Object.freeze(
  getTemplateOptions().reduce((lookup, template) => {
    lookup[template.key] = template.label;
    return lookup;
  }, {})
);

export const STATUS_META = {
  draft: "Draft",
  pm_scheduled: "PM Scheduled",
  handed_off_pending_is: "Handed Off",
  is_active: "Active",
  closed: "Closed",
};

export const LIFECYCLE_STATE_META = {
  draft: "Draft",
  pm_scheduled: "PM Scheduled",
  handed_off_pending_is: "Handed Off",
  is_active: "Active",
  closed: "Closed",
};

export const RECONCILIATION_STATE_META = {
  not_applicable: "Not Applicable",
  in_sync: "In Sync",
  drift_detected: "Drift Detected",
  refresh_failed: "Refresh Failed",
};

function normalizeInvitees(value) {
  if (Array.isArray(value)) {
    return value
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(Boolean);
  }

  return String(value || "")
    .split(/[,;\n]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function ensureHypercareDuration(value) {
  if (value === "2 weeks" || value === "2") return "2 weeks";
  return "1 week";
}

function ensureSmartFillPreference(value) {
  if (value === "am" || value === "pm") return value;
  return "none";
}

function normalizeWorkingDays(value) {
  const days = [...new Set((Array.isArray(value) ? value : []).map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((left, right) => left - right);

  return days.length ? days : [...DEFAULT_WORKING_DAYS];
}

function normalizeLifecycleState(value) {
  if (Object.hasOwn(LIFECYCLE_STATE_META, value)) return value;
  return "";
}

function normalizeReconciliationState(value) {
  if (Object.hasOwn(RECONCILIATION_STATE_META, value)) return value;
  return "";
}

function addDays(date, amount) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function createOneOffTemplateKey() {
  return `oneoff_${uid().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
}

function resolveTemplateSource(source, fallbackKey = "manufacturing") {
  if (typeof source === "string") {
    return getTemplateDefinition(source || fallbackKey);
  }

  const templateKey = String(source?.templateKey || source?.projectType || fallbackKey || "manufacturing").trim() || "manufacturing";
  return getTemplateDefinition(templateKey, { templateSnapshot: source?.templateSnapshot || null });
}

export function getProjectTemplate(project) {
  return resolveTemplateSource(project);
}

export function getProjectTemplateLabel(projectOrKey) {
  if (!projectOrKey) return getTemplateLabel("custom");
  if (typeof projectOrKey === "string") return getTemplateLabel(projectOrKey);
  return (
    projectOrKey.templateLabel
    || resolveTemplateSource(projectOrKey).label
    || getTemplateLabel(projectOrKey.templateKey || projectOrKey.projectType || "custom")
  );
}

function getTemplatePhase(source, phaseKey) {
  return resolveTemplateSource(source)?.phaseMap?.[phaseKey] || {
    key: phaseKey,
    label: PHASE_META[phaseKey]?.label || phaseKey,
    owner: PHASE_META[phaseKey]?.owner || "pm",
    ownerLabel: PHASE_META[phaseKey]?.ownerLabel || "PM",
    calendarSource: PHASE_META[phaseKey]?.owner || "pm",
    durationWeeks: { min: null, max: null },
    suggestedWeeksMin: null,
    suggestedWeeksMax: null,
    stages: [],
    sessions: [],
  };
}

function makeSession(definition, index, phaseKey = definition?.phase || "implementation", stageKey = definition?.stageKey || "") {
  const key = String(definition?.key || "").trim();
  const bodyKey = definition?.bodyKey === undefined
    ? key || null
    : definition?.bodyKey === null
      ? null
      : String(definition?.bodyKey || "").trim() || null;
  const duration = Number(definition?.duration ?? definition?.durationMinutes) || 90;
  return {
    id: definition?.id || uid(),
    key,
    bodyKey,
    name: String(definition?.name || "").trim(),
    duration,
    durationMinutes: duration,
    phase: phaseKey,
    stageKey,
    owner: definition?.owner || PHASE_META[phaseKey].owner,
    type: definition?.type || "external",
    order: Number.isFinite(definition?.order) ? Number(definition.order) : index,
    phaseOrder: Number.isFinite(definition?.phaseOrder) ? Number(definition.phaseOrder) : index,
    grandOrder: Number.isFinite(definition?.grandOrder) ? Number(definition.grandOrder) : index,
    gating: definition?.gating ? cloneValue(definition.gating) : null,
    calendarSource: definition?.calendarSource || definition?.phaseCalendarSource || PHASE_META[phaseKey].owner,
    date: definition?.date || "",
    time: definition?.time || "",
    lastKnownStart: definition?.lastKnownStart || "",
    lastKnownEnd: definition?.lastKnownEnd || "",
    graphEventId: definition?.graphEventId || "",
    graphActioned: Boolean(definition?.graphActioned),
    outlookActioned: Boolean(definition?.outlookActioned),
    locked: Boolean(definition?.locked),
    lockedDate: Boolean(definition?.lockedDate ?? definition?.locked),
    lockedTime: Boolean(definition?.lockedTime),
    availabilityConflict: Boolean(definition?.availabilityConflict),
  };
}

function makeStage(definition, phaseKey, index) {
  const key = String(definition?.key || `${phaseKey}_stage_${index + 1}`);
  return {
    key,
    label: String(definition?.label || `Stage ${index + 1}`).trim() || `Stage ${index + 1}`,
    order: Number.isFinite(definition?.order) ? Number(definition.order) : index,
    rangeStart: definition?.rangeStart || "",
    rangeEnd: definition?.rangeEnd || "",
    sessions: (definition?.sessions || [])
      .map((session, sessionIndex) => makeSession({ ...session, phase: phaseKey, stageKey: key }, sessionIndex, phaseKey, key))
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name)),
  };
}

function createPhaseFromTemplate(source, phaseKey, { includeSessions = true } = {}) {
  const templatePhase = getTemplatePhase(source, phaseKey);
  return {
    key: templatePhase.key || phaseKey,
    label: templatePhase.label || PHASE_META[phaseKey].label,
    owner: templatePhase.owner || PHASE_META[phaseKey].owner,
    ownerLabel: templatePhase.ownerLabel || PHASE_META[phaseKey].ownerLabel,
    calendarSource: templatePhase.calendarSource || templatePhase.owner || PHASE_META[phaseKey].owner,
    durationWeeks: cloneValue(templatePhase.durationWeeks || { min: null, max: null }),
    suggestedWeeksMin: Number.isFinite(templatePhase.suggestedWeeksMin) ? templatePhase.suggestedWeeksMin : null,
    suggestedWeeksMax: Number.isFinite(templatePhase.suggestedWeeksMax) ? templatePhase.suggestedWeeksMax : null,
    stages: (templatePhase.stages || []).map((stage, stageIndex) =>
      makeStage(
        {
          ...stage,
          sessions: includeSessions
            ? (stage.sessions || []).map((session, sessionIndex) => ({
                ...session,
                phase: phaseKey,
                stageKey: stage.key,
                order: sessionIndex,
                phaseOrder: session.phaseOrder,
                grandOrder: session.grandOrder,
                calendarSource: templatePhase.calendarSource || templatePhase.owner || PHASE_META[phaseKey].owner,
              }))
            : [],
        },
        phaseKey,
        stageIndex
      )
    ),
  };
}

function normalizeProjectOrders(project) {
  let grandOrder = 0;
  PHASE_ORDER.forEach((phaseKey) => {
    let phaseOrder = 0;
    getPhaseStages(project, phaseKey).forEach((stage, stageIndex) => {
      stage.order = stageIndex;
      stage.sessions.forEach((session, sessionIndex) => {
        session.order = sessionIndex;
        session.phaseOrder = phaseOrder;
        session.grandOrder = grandOrder;
        session.phase = phaseKey;
        session.stageKey = stage.key;
        session.calendarSource = project?.phases?.[phaseKey]?.calendarSource || session.calendarSource || PHASE_META[phaseKey].owner;
        session.durationMinutes = Number(session.durationMinutes ?? session.duration) || 90;
        grandOrder += 1;
        phaseOrder += 1;
      });
    });
  });
}

function migrationSessionLabel(session) {
  return session?.key || session?.bodyKey || session?.name || "unknown";
}

function getOrCreateManualStage(phase, phaseKey) {
  let stage = phase.stages.find((candidate) => candidate.key === `manual_${phaseKey}`);
  if (!stage) {
    stage = makeStage(
      {
        key: `manual_${phaseKey}`,
        label: "Manual",
        sessions: [],
      },
      phaseKey,
      phase.stages.length
    );
    phase.stages.push(stage);
  }
  return stage;
}

function buildMigrationCandidates(source, phaseKey) {
  const templatePhase = getTemplatePhase(source, phaseKey);
  return (templatePhase.stages || []).flatMap((stage) =>
    (stage.sessions || []).map((session) => ({
      stageKey: stage.key,
      key: session.key,
      bodyKey: session.bodyKey || session.key || "",
      name: session.name,
      duration: session.durationMinutes || session.duration,
      used: false,
    }))
  );
}

function findMigrationCandidate(candidates, predicate) {
  return candidates.find((candidate) => !candidate.used && predicate(candidate)) || null;
}

function migrateLegacyPhase(source, phaseKey, legacyPhase = {}) {
  const phase = createPhaseFromTemplate(source, phaseKey, { includeSessions: false });
  const candidates = buildMigrationCandidates(source, phaseKey);
  const legacySessions = Array.isArray(legacyPhase?.sessions) ? legacyPhase.sessions : [];

  for (const legacySession of legacySessions) {
    const key = migrationSessionLabel(legacySession);
    let match = findMigrationCandidate(candidates, (candidate) => candidate.key && candidate.key === legacySession.key);

    if (!match) {
      match = findMigrationCandidate(
        candidates,
        (candidate) =>
          candidate.bodyKey
          && candidate.bodyKey === (legacySession.bodyKey || legacySession.key)
          && candidate.name === legacySession.name
      );
    }

    if (!match) {
      match = findMigrationCandidate(
        candidates,
        (candidate) => candidate.name === legacySession.name && Number(candidate.duration) === Number(legacySession.duration)
      );
    }

    if (!match) {
      const manualStage = getOrCreateManualStage(phase, phaseKey);
      manualStage.sessions.push(
        makeSession({ ...legacySession, phase: phaseKey, stageKey: manualStage.key }, manualStage.sessions.length, phaseKey, manualStage.key)
      );
      continue;
    }

    match.used = true;
    const targetStage = phase.stages.find((stage) => stage.key === match.stageKey);
    if (targetStage) {
      targetStage.sessions.push(
        makeSession({ ...legacySession, phase: phaseKey, stageKey: targetStage.key }, targetStage.sessions.length, phaseKey, targetStage.key)
      );
    }
  }

  normalizeProjectOrders({ phases: { [phaseKey]: phase } });
  return phase;
}

function normalizeModernPhase(source, phaseKey, phase = {}) {
  const templatePhase = getTemplatePhase(source, phaseKey);
  const templateStages = new Map((templatePhase.stages || []).map((stage) => [stage.key, stage]));

  return {
    key: phaseKey,
    label: phase?.label || templatePhase.label || PHASE_META[phaseKey].label,
    owner: phase?.owner || templatePhase.owner || PHASE_META[phaseKey].owner,
    ownerLabel: templatePhase.ownerLabel || PHASE_META[phaseKey].ownerLabel,
    calendarSource: phase?.calendarSource || templatePhase.calendarSource || templatePhase.owner || PHASE_META[phaseKey].owner,
    durationWeeks: cloneValue(phase?.durationWeeks || templatePhase.durationWeeks || { min: null, max: null }),
    suggestedWeeksMin: Number.isFinite(phase?.suggestedWeeksMin) ? Number(phase.suggestedWeeksMin) : templatePhase.suggestedWeeksMin ?? null,
    suggestedWeeksMax: Number.isFinite(phase?.suggestedWeeksMax) ? Number(phase.suggestedWeeksMax) : templatePhase.suggestedWeeksMax ?? null,
    stages: (phase?.stages || []).map((stage, index) => {
      const templateStage = templateStages.get(stage?.key);
      return makeStage(
        {
          key: stage?.key || templateStage?.key,
          label: stage?.label || templateStage?.label,
          order: stage?.order,
          rangeStart: stage?.rangeStart,
          rangeEnd: stage?.rangeEnd,
          sessions: (stage?.sessions || []).map((session, sessionIndex) => ({
            ...session,
            phase: phaseKey,
            stageKey: stage?.key || templateStage?.key,
            order: Number.isFinite(session?.order) ? Number(session.order) : sessionIndex,
            phaseOrder: Number.isFinite(session?.phaseOrder) ? Number(session.phaseOrder) : sessionIndex,
            calendarSource: phase?.calendarSource || templatePhase.calendarSource || templatePhase.owner || PHASE_META[phaseKey].owner,
          })),
        },
        phaseKey,
        index
      );
    }),
  };
}

function normalizePhaseContainer(source, phaseKey, phase = null) {
  if (phase?.stages) {
    return normalizeModernPhase(source, phaseKey, phase);
  }
  if (phase?.sessions) {
    return migrateLegacyPhase(source, phaseKey, phase);
  }
  return createPhaseFromTemplate(source, phaseKey);
}

export function getLockedPhaseSessions(project, phaseKey) {
  return getPhaseSessions(project, phaseKey).filter((session) => session.lockedDate);
}

export function getPhaseGateSession(project, phaseKey) {
  return getPhaseSessions(project, phaseKey).find((session) => session.gating?.type === "phase_gate") || null;
}

export function isSessionBeforePhaseGate(project, session) {
  if (!project || !session) return false;
  const gate = getPhaseGateSession(project, session.phase);
  if (!gate) return false;
  const sessionOrder = Number.isFinite(session.phaseOrder) ? Number(session.phaseOrder) : Number(session.order);
  const gateOrder = Number.isFinite(gate.phaseOrder) ? Number(gate.phaseOrder) : Number(gate.order);
  return Number.isFinite(sessionOrder) && Number.isFinite(gateOrder) && sessionOrder < gateOrder;
}

function syncLockedAnchorSessions(project) {
  getLockedPhaseSessions(project, "implementation").forEach((session) => {
    session.phase = "implementation";
    session.owner = session.owner || "is";
    session.lockedDate = true;
    session.date = project.goLiveDate || "";
    session.time = session.time || "08:30";

    const stage = getStageForSession(project, session);
    if (stage) {
      stage.rangeStart = project.goLiveDate || "";
      stage.rangeEnd = project.goLiveDate || "";
    }
  });
}

function weeksBetween(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return Math.max(1, Math.ceil(((end.getTime() - start.getTime()) / 86400000 + 1) / 7));
}

function compareByDate(left, right) {
  return left.localeCompare(right);
}

function getPhaseDates(project, phaseKey, { includeLocked = true } = {}) {
  return getPhaseSessions(project, phaseKey)
    .filter((session) => session.date && (includeLocked || !session.lockedDate))
    .map((session) => session.date)
    .sort(compareByDate);
}

function getDateAfter(dateString) {
  if (!dateString) return "";
  return toDateStr(addDays(parseDate(dateString), 1));
}

function getDateBefore(dateString) {
  if (!dateString) return "";
  return toDateStr(addDays(parseDate(dateString), -1));
}

export function createOnboardingDraft(projectType = "manufacturing", options = {}) {
  const templateSnapshot = options.templateSnapshot ? cloneValue(options.templateSnapshot) : null;
  const templateCustomized = Boolean(options.templateCustomized || templateSnapshot);
  const templateOriginKey = String(options.templateOriginKey || projectType || "manufacturing").trim() || "manufacturing";
  const templateKey = String(
    options.templateKey
    || (templateCustomized ? createOneOffTemplateKey() : templateOriginKey)
    || "manufacturing"
  ).trim() || "manufacturing";
  const templateLabel = options.templateLabel || getProjectTemplateLabel({ templateKey, projectType: templateOriginKey, templateSnapshot });
  const templateSource = {
    templateKey,
    projectType: templateOriginKey,
    templateSnapshot,
  };
  const phases = {
    setup: createPhaseFromTemplate(templateSource, "setup"),
    implementation: createPhaseFromTemplate(templateSource, "implementation"),
    hypercare: createPhaseFromTemplate(templateSource, "hypercare"),
  };
  const defaultStageKey = phases.implementation.stages[0]?.key || "";

  return {
    clientName: "",
    projectType: templateOriginKey,
    templateKey,
    templateLabel,
    templateCustomized,
    templateOriginKey,
    templateSnapshot,
    pmName: "",
    pmEmail: "",
    isName: "",
    isEmail: "",
    projectStart: "",
    implementationStart: "",
    goLiveDate: "",
    hypercareDuration: "1 week",
    smartFillPreference: "none",
    workingDays: [...DEFAULT_WORKING_DAYS],
    invitees: "",
    location: "",
    goLiveSuggestedDate: "",
    goLiveRecommendedWeeks: 0,
    goLiveWarning: "",
    goLiveManuallySet: false,
    phases,
    customSession: {
      phase: "implementation",
      stageKey: defaultStageKey,
      newStageLabel: "",
      owner: "is",
      name: "",
      duration: 90,
      type: "external",
      bodyKey: null,
    },
  };
}

export function normalizeProject(project) {
  const templateSnapshot = project?.templateSnapshot ? cloneValue(project.templateSnapshot) : null;
  const templateCustomized = Boolean(project?.templateCustomized || templateSnapshot);
  const templateOriginKey = String(project?.templateOriginKey || project?.projectType || project?.templateKey || "manufacturing").trim() || "manufacturing";
  const templateKey = String(
    project?.templateKey
    || (templateCustomized ? createOneOffTemplateKey() : templateOriginKey)
    || "manufacturing"
  ).trim() || "manufacturing";
  const templateSource = {
    templateKey,
    projectType: templateOriginKey,
    templateSnapshot,
  };
  const template = resolveTemplateSource(templateSource);
  const nextProject = {
    id: project?.id || uid(),
    clientName: String(project?.clientName || "").trim(),
    projectType: templateOriginKey,
    templateKey,
    templateLabel: String(project?.templateLabel || template.label || getTemplateLabel(templateKey)).trim(),
    templateCustomized,
    templateOriginKey,
    templateSnapshot,
    pmName: String(project?.pmName || "").trim(),
    pmEmail: String(project?.pmEmail || "").trim().toLowerCase(),
    isName: String(project?.isName || "").trim(),
    isEmail: String(project?.isEmail || "").trim().toLowerCase(),
    projectStart: project?.projectStart || "",
    implementationStart: project?.implementationStart || "",
    goLiveDate: project?.goLiveDate || "",
    hypercareDuration: ensureHypercareDuration(project?.hypercareDuration),
    smartFillPreference: ensureSmartFillPreference(project?.smartFillPreference),
    workingDays: normalizeWorkingDays(project?.workingDays),
    location: String(project?.location || "").trim(),
    invitees: normalizeInvitees(project?.invitees),
    phases: {
      setup: normalizePhaseContainer(templateSource, "setup", project?.phases?.setup || null),
      implementation: normalizePhaseContainer(templateSource, "implementation", project?.phases?.implementation || null),
      hypercare: normalizePhaseContainer(templateSource, "hypercare", project?.phases?.hypercare || null),
    },
    handoff: {
      sentAt: project?.handoff?.sentAt || "",
      delegateUsed: Boolean(project?.handoff?.delegateUsed),
      deepLinkUrl: project?.handoff?.deepLinkUrl || "",
      deepLinkLength: Number(project?.handoff?.deepLinkLength) || 0,
      eventId: project?.handoff?.eventId || "",
    },
    reconciliation: {
      state: normalizeReconciliationState(project?.reconciliation?.state),
      lastAttemptedAt: project?.reconciliation?.lastAttemptedAt || "",
      lastSuccessfulAt: project?.reconciliation?.lastSuccessfulAt || "",
      lastFailureAt: project?.reconciliation?.lastFailureAt || "",
      lastFailureMessage: project?.reconciliation?.lastFailureMessage || "",
    },
    isCommittedAt: project?.isCommittedAt || "",
    completedAt: project?.completedAt || "",
    closedAt: project?.closedAt || "",
    closedBy: String(project?.closedBy || "").trim(),
    lifecycleState: normalizeLifecycleState(project?.lifecycleState),
    reconciliationState: normalizeReconciliationState(project?.reconciliationState),
    createdAt: project?.createdAt || new Date().toISOString(),
    updatedAt: project?.updatedAt || new Date().toISOString(),
    status: project?.status || "draft",
  };

  normalizeProjectOrders(nextProject);
  syncLockedAnchorSessions(nextProject);
  return syncProjectRuntimeState(nextProject);
}

export function cloneProject(project) {
  return normalizeProject(cloneValue(project));
}

export function createProjectFromDraft(draft) {
  return normalizeProject({
    clientName: draft.clientName,
    projectType: draft.projectType,
    templateKey: draft.templateKey,
    templateLabel: draft.templateLabel,
    templateCustomized: draft.templateCustomized,
    templateOriginKey: draft.templateOriginKey,
    templateSnapshot: cloneValue(draft.templateSnapshot),
    pmName: draft.pmName,
    pmEmail: draft.pmEmail,
    isName: draft.isName,
    isEmail: draft.isEmail,
    projectStart: draft.projectStart,
    implementationStart: draft.implementationStart,
    goLiveDate: draft.goLiveDate,
    hypercareDuration: draft.hypercareDuration,
    smartFillPreference: draft.smartFillPreference,
    workingDays: draft.workingDays,
    location: draft.location,
    invitees: draft.invitees,
    phases: cloneValue(draft.phases),
  });
}

export function getProjectById(projects, projectId) {
  return projects.find((project) => project.id === projectId) || null;
}

export function getPhaseStages(project, phaseKey) {
  return (project?.phases?.[phaseKey]?.stages || []).slice().sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
}

export function getStageSessions(project, phaseKey, stageKey) {
  const stage = getPhaseStages(project, phaseKey).find((candidate) => candidate.key === stageKey);
  return stage?.sessions || [];
}

export function getPhaseSessions(project, phaseKey) {
  return getPhaseStages(project, phaseKey).flatMap((stage) => stage.sessions);
}

export function getAllSessions(project) {
  return PHASE_ORDER.flatMap((phaseKey) => getPhaseSessions(project, phaseKey));
}

export function findSession(project, sessionId) {
  for (const phaseKey of PHASE_ORDER) {
    const stages = getPhaseStages(project, phaseKey);
    for (const stage of stages) {
      const index = stage.sessions.findIndex((session) => session.id === sessionId);
      if (index >= 0) {
        return {
          phaseKey,
          stageKey: stage.key,
          stage,
          index,
          session: stage.sessions[index],
        };
      }
    }
  }

  return null;
}

export function getStageForSession(project, sessionOrId) {
  const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.id;
  const found = sessionId ? findSession(project, sessionId) : null;
  return found?.stage || null;
}

export function recomputeStageRange(stage) {
  if (!stage) return null;

  const dates = (stage.sessions || [])
    .filter((session) => !session.lockedDate && session.date)
    .map((session) => session.date)
    .sort(compareByDate);

  stage.rangeStart = dates[0] || "";
  stage.rangeEnd = dates[dates.length - 1] || "";
  return stage;
}

function createManualStage(project, phaseKey, label) {
  const stage = makeStage(
    {
      key: `${phaseKey}_manual_${uid()}`,
      label: String(label || "Manual").trim() || "Manual",
      sessions: [],
    },
    phaseKey,
    getPhaseStages(project, phaseKey).length
  );
  project.phases[phaseKey].stages.push(stage);
  normalizeProjectOrders(project);
  return stage;
}

export function addCustomSession(project, sessionInput) {
  const phaseKey = sessionInput.phase || "implementation";
  const phase = project.phases[phaseKey];
  if (!phase) return null;

  let stage = getPhaseStages(project, phaseKey).find((candidate) => candidate.key === sessionInput.stageKey);
  if (!stage) {
    stage = createManualStage(project, phaseKey, sessionInput.newStageLabel || "Manual");
  }

  stage.sessions.push(
    makeSession(
      {
        ...sessionInput,
        phase: phaseKey,
        stageKey: stage.key,
        owner: sessionInput.owner || phase.owner || PHASE_META[phaseKey].owner,
        key: sessionInput.key || "",
        bodyKey: sessionInput.bodyKey ?? sessionInput.key ?? null,
        calendarSource: phase.calendarSource || phase.owner || PHASE_META[phaseKey].owner,
      },
      stage.sessions.length,
      phaseKey,
      stage.key
    )
  );

  normalizeProjectOrders(project);
  touchProject(project);
  project.status = deriveProjectStatus(project);
  return stage;
}

export function removeSession(project, sessionId) {
  const found = findSession(project, sessionId);
  if (!found) return;

  found.stage.sessions.splice(found.index, 1);
  recomputeStageRange(found.stage);
  normalizeProjectOrders(project);
  touchProject(project);
  project.status = deriveProjectStatus(project);
}

export function moveSession(project, sessionId, direction) {
  const found = findSession(project, sessionId);
  if (!found) return;

  const sessions = found.stage.sessions;
  const targetIndex = found.index + direction;
  if (targetIndex < 0 || targetIndex >= sessions.length) return;

  const [session] = sessions.splice(found.index, 1);
  sessions.splice(targetIndex, 0, session);
  normalizeProjectOrders(project);
  touchProject(project);
}

export function touchProject(project) {
  project.updatedAt = new Date().toISOString();
  return syncProjectRuntimeState(project);
}

export function getPhaseRange(project, phaseKey) {
  const dated = getPhaseDates(project, phaseKey);
  if (!dated.length) return "";
  if (dated.length === 1) return dated[0];
  return `${dated[0]}:${dated[dated.length - 1]}`;
}

export function getPhaseSpanWeeks(project, phaseKey) {
  const dates = getPhaseDates(project, phaseKey);
  return dates.length ? weeksBetween(dates[0], dates[dates.length - 1]) : 0;
}

export function getPhaseSummary(project, phaseKey) {
  const phase = project?.phases?.[phaseKey];
  const sessions = getPhaseSessions(project, phaseKey);
  const scheduled = sessions.filter((session) => session.date && session.time).length;
  const dated = sessions.filter((session) => session.date && !session.lockedDate).map((session) => session.date).sort(compareByDate);
  const spanWeeks = dated.length ? weeksBetween(dated[0], dated[dated.length - 1]) : 0;
  const minWeeks = Number.isFinite(phase?.suggestedWeeksMin) ? phase.suggestedWeeksMin : null;
  const maxWeeks = Number.isFinite(phase?.suggestedWeeksMax) ? phase.suggestedWeeksMax : null;

  return {
    total: sessions.length,
    scheduled,
    rangeStart: dated[0] || "",
    rangeEnd: dated[dated.length - 1] || "",
    spanWeeks,
    suggestedWeeksMin: minWeeks,
    suggestedWeeksMax: maxWeeks,
    exceedsSuggestedMax: Boolean(maxWeeks && spanWeeks > maxWeeks),
  };
}

export function getWindowForPhase(project, phaseKey) {
  if (phaseKey === "setup") {
    return {
      min: project.projectStart || "",
      max: project.implementationStart ? toDateStr(addDays(parseDate(project.implementationStart), -1)) : "",
    };
  }

  if (phaseKey === "implementation") {
    return {
      min: project.implementationStart || "",
      max: project.goLiveDate || "",
    };
  }

  if (phaseKey === "hypercare") {
    const start = project.goLiveDate ? toDateStr(addDays(parseDate(project.goLiveDate), 1)) : "";
    const weeks = ensureHypercareDuration(project.hypercareDuration) === "2 weeks" ? 14 : 7;
    return {
      min: start,
      max: start ? toDateStr(addDays(parseDate(start), weeks - 1)) : "",
    };
  }

  return { min: "", max: "" };
}

function getEffectiveWindowMin(project, session, window) {
  if (
    session?.phase !== "setup"
    || session?.type !== "internal"
    || !project?.projectStart
    || !isSessionBeforePhaseGate(project, session)
  ) {
    return window.min;
  }

  return toDateStr(addDays(parseDate(project.projectStart), -INTERNAL_SETUP_BUFFER_DAYS));
}

export function getStageRangeForSession(project, session) {
  const stage = getStageForSession(project, session);
  if (!stage) {
    return {
      label: "",
      start: "",
      end: "",
    };
  }

  return {
    label: stage.label,
    start: stage.rangeStart || "",
    end: stage.rangeEnd || "",
  };
}

export function isDateWithinStageRange(project, session, dateString) {
  if (!dateString || session?.lockedDate) return true;
  const range = getStageRangeForSession(project, session);
  if (range.start && dateString < range.start) return false;
  if (range.end && dateString > range.end) return false;
  return true;
}

export function isDateWithinPhaseWindow(project, session, dateString) {
  if (!dateString || session?.lockedDate) return true;

  const window = getWindowForPhase(project, session.phase);
  let effectiveMin = getEffectiveWindowMin(project, session, window);
  let effectiveMax = window.max;

  if (session.phase === "setup") {
    const setupDates = getPhaseDates(project, "setup");
    if (setupDates.length && effectiveMin && setupDates[0] < effectiveMin) {
      effectiveMin = setupDates[0];
    }
    const implDates = getPhaseDates(project, "implementation", { includeLocked: false });
    if (implDates.length) {
      effectiveMax = getDateBefore(implDates[0]);
    }
  } else if (session.phase === "implementation") {
    const setupDates = getPhaseDates(project, "setup");
    if (setupDates.length) {
      effectiveMin = getDateAfter(setupDates[setupDates.length - 1]);
    }
  } else if (session.phase === "hypercare") {
    const implDates = getPhaseDates(project, "implementation");
    if (implDates.length) {
      effectiveMin = getDateAfter(implDates[implDates.length - 1]);
    }
  }

  if (effectiveMin && dateString < effectiveMin) return false;
  if (effectiveMax && dateString > effectiveMax) return false;
  return true;
}

export function canEditSession(project, session, actor) {
  if (!project || !session || !actor || session.locked) return false;
  if (actor === "pm") {
    if (session.phase === "implementation" && !pmCanEditImplementation(project)) {
      return false;
    }
    return true;
  }
  return getCalendarOwnerForPhase(session.phase, project) === actor;
}

export function pmCanEditImplementation(project) {
  const lifecycleState = deriveProjectLifecycleState(project);
  return lifecycleState === "draft" || lifecycleState === "pm_scheduled";
}

export function canCommitSession(session, actor) {
  if (!session || !actor) return false;
  if (session.type === "internal") return false;
  if (actor === "pm") return session.owner === "pm";
  return session.owner === "is";
}

export function getCalendarOwnerForPhase(phaseKey, project = null) {
  return getPhaseCalendarOwner(phaseKey, project);
}

export function getVisiblePhaseKeys(actor, project = null) {
  if (actor !== "is") return [...PHASE_ORDER];
  if (!project) return ["implementation"];
  return PHASE_ORDER.filter((phaseKey) => getCalendarOwnerForPhase(phaseKey, project) === "is");
}

export function getContextPhaseKeys(actor, project = null) {
  if (actor !== "is") return [];
  const visible = new Set(getVisiblePhaseKeys(actor, project));
  return PHASE_ORDER.filter((phaseKey) => !visible.has(phaseKey));
}

export function getEditableSessions(project, actor) {
  return getAllSessions(project).filter((session) => canEditSession(project, session, actor));
}

export function getConflictReviewSessions(project, actor) {
  return getAllSessions(project).filter(
    (session) =>
      (actor === "pm" || session.owner === actor)
      && session.type !== "internal"
      && session.date
      && canEditSession(project, session, actor)
  );
}

export function getPushableSessions(project, actor) {
  return getAllSessions(project).filter(
    (session) => canCommitSession(session, actor) && session.date && session.time
  );
}

export function getSchedulableSessions(project, actor = "pm") {
  return getAllSessions(project).filter((session) => canEditSession(project, session, actor));
}

export function getProjectAnchor(project) {
  return getLockedPhaseSessions(project, "implementation")[0] || null;
}

export function getHypercareWindowDates(project) {
  const window = getWindowForPhase(project, "hypercare");
  if (!window.min || !window.max) return [];

  const dates = [];
  let cursor = parseDate(window.min);
  const endDate = parseDate(window.max);
  while (cursor <= endDate) {
    dates.push(toDateStr(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function getActorDisplayName(project, actor) {
  if (actor === "is") return project?.isName || "Implementation Specialist";
  if (actor === "shared") return "Shared";
  return project?.pmName || "Project Manager";
}

export function getCalendarOwnerName(project, phaseKey) {
  const owner = phaseKey ? getCalendarOwnerForPhase(phaseKey, project) : "pm";
  if (owner === "is") return project?.isName || "Implementation Specialist";
  if (owner === "shared") return "Shared";
  return project?.pmName || "Project Manager";
}

export function projectHasImplementationReady(project) {
  const sessions = getPhaseSessions(project, "implementation");
  return sessions.length > 0 && sessions.every((session) => session.date && session.time);
}

export function projectHasPendingCommit(project) {
  return deriveProjectStatus(project) === "handed_off_pending_is";
}

export function projectIsClosed(project) {
  return deriveProjectStatus(project) === "closed";
}

export function deriveProjectLifecycleState(project) {
  const explicit = normalizeLifecycleState(project?.lifecycleState);
  if (project?.closedAt) {
    return "closed";
  }

  if (project?.handoff?.sentAt) {
    if (project?.isCommittedAt) {
      return "is_active";
    }

    const implementationSessions = getPhaseSessions(project, "implementation");
    const implementationActive = implementationSessions.some(
      (session) => session.graphActioned || session.graphEventId || session.lastKnownStart || session.lastKnownEnd
    );
    if (implementationActive) {
      return "is_active";
    }
    if (explicit === "is_active" || explicit === "handed_off_pending_is") {
      return explicit;
    }
    return "handed_off_pending_is";
  }

  if (projectHasImplementationReady(project)) {
    return "pm_scheduled";
  }

  return explicit === "draft" || explicit === "pm_scheduled" ? explicit : "draft";
}

export function deriveProjectReconciliationState(project) {
  const explicit =
    normalizeReconciliationState(project?.reconciliationState)
    || normalizeReconciliationState(project?.reconciliation?.state);
  if (explicit) return explicit;

  return "not_applicable";
}

export function deriveProjectStatus(project) {
  return deriveProjectLifecycleState(project);
}

export function syncProjectRuntimeState(project) {
  if (!project) return project;
  project.lifecycleState = deriveProjectLifecycleState(project);
  project.reconciliationState =
    normalizeReconciliationState(project.reconciliationState)
    || normalizeReconciliationState(project.reconciliation?.state)
    || deriveProjectReconciliationState(project);
  if (project.reconciliation) {
    project.reconciliation.state = project.reconciliationState;
  }
  project.status = deriveProjectStatus(project);
  return project;
}

export function getProjectCardStatus(project) {
  return STATUS_META[deriveProjectStatus(project)] || STATUS_META.draft;
}

function sessionDateTimeValue(session) {
  if (!session?.date || !session?.time) return null;
  const [hours, minutes] = String(session.time).split(":").map(Number);
  const value = parseDate(session.date);
  value.setHours(hours || 0, minutes || 0, 0, 0);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function projectReadyToClose(project, now = new Date()) {
  if (!project || deriveProjectLifecycleState(project) === "closed") return false;
  if (deriveProjectReconciliationState(project) !== "in_sync") return false;

  const sessions = getAllSessions(project);
  if (!sessions.length) return false;

  return sessions.every((session) => {
    const value = sessionDateTimeValue(session);
    return Boolean(value) && value < now;
  });
}

export function getProjectCounts(project) {
  const sessions = getAllSessions(project);
  const scheduled = sessions.filter((session) => session.date && session.time).length;
  return {
    total: sessions.length,
    scheduled,
  };
}

export function getProjectContextSummary(project) {
  return {
    setup: getPhaseSummary(project, "setup"),
    hypercare: getPhaseSummary(project, "hypercare"),
    goLiveDate: project.goLiveDate,
  };
}

export function getProjectDateRange(project) {
  const datedSessions = getAllSessions(project)
    .filter((session) => session.date)
    .map((session) => session.date)
    .sort(compareByDate);
  const windowStart = datedSessions[0] || project.projectStart || project.implementationStart || toDateStr(new Date());
  const hypercareWindow = getWindowForPhase(project, "hypercare");
  const windowEnd = hypercareWindow.max || project.goLiveDate || datedSessions[datedSessions.length - 1] || windowStart;
  return {
    start: windowStart,
    end: windowEnd,
  };
}

export function computeImplementationStart(source) {
  const projectStart = source?.projectStart || "";
  if (!projectStart) return "";
  const setupPhase = source?.phases?.setup || {};
  const suggestedWeeksMin = Number.isFinite(setupPhase?.suggestedWeeksMin) ? setupPhase.suggestedWeeksMin : 2;
  const workingDays = normalizeWorkingDays(source?.workingDays);
  const cursor = addDays(parseDate(projectStart), suggestedWeeksMin * 7);
  while (workingDays.length && !workingDays.includes(cursor.getDay())) {
    cursor.setDate(cursor.getDate() + 1);
  }
  return toDateStr(cursor);
}

export function getTimelineSuggestion(source) {
  const workingDays = normalizeWorkingDays(source?.workingDays);
  const projectStart = source?.projectStart || "";
  const setupPhase = source?.phases?.setup || {};
  const implPhase = source?.phases?.implementation || {};
  const hypercarePhase = source?.phases?.hypercare || {};
  const setupMin = Number.isFinite(setupPhase?.suggestedWeeksMin) ? setupPhase.suggestedWeeksMin : null;
  const setupMax = Number.isFinite(setupPhase?.suggestedWeeksMax) ? setupPhase.suggestedWeeksMax : null;
  const implMin = Number.isFinite(implPhase?.suggestedWeeksMin) ? implPhase.suggestedWeeksMin : null;
  const implMax = Number.isFinite(implPhase?.suggestedWeeksMax) ? implPhase.suggestedWeeksMax : null;
  const hcMin = Number.isFinite(hypercarePhase?.suggestedWeeksMin) ? hypercarePhase.suggestedWeeksMin : null;
  const hcMax = Number.isFinite(hypercarePhase?.suggestedWeeksMax) ? hypercarePhase.suggestedWeeksMax : null;
  const totalMin = (setupMin || 0) + (implMin || 0) + (hcMin || 0);
  const totalMax = (setupMax || 0) + (implMax || 0) + (hcMax || 0);
  const implSessions = getPhaseSessions(source, "implementation").filter((session) => !session.lockedDate);
  const implFloor = implSessions.length ? Math.ceil(implSessions.length / 3) : 0;

  function roundToWorkingDay(date) {
    const d = new Date(date);
    while (workingDays.length && !workingDays.includes(d.getDay())) d.setDate(d.getDate() + 1);
    return d;
  }

  let earliestGoLive = "";
  let earliestWrapUp = "";
  if (projectStart && workingDays.length) {
    const implWeeks = Math.max(implMin || 0, implFloor);
    const goLiveCursor = roundToWorkingDay(addDays(parseDate(projectStart), ((setupMin || 0) + implWeeks) * 7));
    earliestGoLive = toDateStr(goLiveCursor);
    const wrapUpCursor = roundToWorkingDay(addDays(goLiveCursor, (hcMin || 1) * 7));
    earliestWrapUp = toDateStr(wrapUpCursor);
  }

  return {
    setupMin,
    setupMax,
    implMin,
    implMax,
    hcMin,
    hcMax,
    totalMin,
    totalMax,
    implFloor,
    implFloorExceedsMin: implFloor > (implMin || 0),
    earliestGoLive,
    earliestWrapUp,
    projectStart,
  };
}

export function getSuggestedGoLive(source) {
  const workingDays = normalizeWorkingDays(source?.workingDays);
  const implementationStart = source?.implementationStart || "";
  if (!implementationStart) {
    return {
      suggestedDate: "",
      recommendedWeeks: 0,
      minimumWeeksAtThreePerWeek: 0,
      warning: "",
    };
  }

  const implementationPhase = source?.phases?.implementation || {};
  const suggestedWeeksMin = Number.isFinite(implementationPhase?.suggestedWeeksMin) ? implementationPhase.suggestedWeeksMin : 0;
  const suggestedWeeksMax = Number.isFinite(implementationPhase?.suggestedWeeksMax) ? implementationPhase.suggestedWeeksMax : 0;
  const implementationSessions = getPhaseSessions(source, "implementation").filter((session) => !session.lockedDate);
  const minimumWeeksAtThreePerWeek = implementationSessions.length ? Math.ceil(implementationSessions.length / 3) : 0;
  const recommendedWeeks = Math.max(suggestedWeeksMin || 0, minimumWeeksAtThreePerWeek);

  if (!workingDays.length) {
    return {
      suggestedDate: "",
      recommendedWeeks,
      minimumWeeksAtThreePerWeek,
      warning: "",
    };
  }

  const cursor = addDays(parseDate(implementationStart), recommendedWeeks * 7);
  while (!workingDays.includes(cursor.getDay())) {
    cursor.setDate(cursor.getDate() + 1);
  }

  const warning =
    suggestedWeeksMax && recommendedWeeks > suggestedWeeksMax
      ? `This timeline may be too tight. Minimum recommended is ${recommendedWeeks} weeks for this template.`
      : "";

  return {
    suggestedDate: toDateStr(cursor),
    recommendedWeeks,
    minimumWeeksAtThreePerWeek,
    warning,
  };
}
