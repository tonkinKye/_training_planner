import { GO_LIVE_SESSION_KEY, getTemplateDefinition } from "./session-templates.js";
import { parseDate, toDateStr } from "./utils.js";
import { uid } from "./state.js";

export const PHASE_ORDER = ["setup", "implementation", "hypercare"];
export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

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

export const PROJECT_TYPE_META = {
  manufacturing: "Manufacturing",
  warehousing: "Warehousing",
  custom: "Custom",
};

export const STATUS_META = {
  scheduling: "Scheduling",
  pending_is_commit: "Pending IS",
  active: "Active",
  complete: "Complete",
  closed: "Closed",
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

function getTemplatePhase(projectType, phaseKey) {
  return getTemplateDefinition(projectType)?.phases?.[phaseKey] || {
    suggestedWeeksMin: null,
    suggestedWeeksMax: null,
    stages: [],
  };
}

function makeSession(definition, index, phaseKey = definition?.phase || "implementation", stageKey = definition?.stageKey || "") {
  const key = String(definition?.key || "").trim();
  return {
    id: definition?.id || uid(),
    key,
    bodyKey: String(definition?.bodyKey || key).trim(),
    name: String(definition?.name || "").trim(),
    duration: Number(definition?.duration) || 90,
    phase: phaseKey,
    stageKey,
    owner: definition?.owner || PHASE_META[phaseKey].owner,
    type: definition?.type || "external",
    order: Number.isFinite(definition?.order) ? Number(definition.order) : index,
    date: definition?.date || "",
    time: definition?.time || "",
    graphEventId: definition?.graphEventId || "",
    graphActioned: Boolean(definition?.graphActioned),
    outlookActioned: Boolean(definition?.outlookActioned),
    locked: Boolean(definition?.locked),
    lockedDate: Boolean(definition?.lockedDate || key === GO_LIVE_SESSION_KEY),
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

function createPhaseFromTemplate(projectType, phaseKey, { includeSessions = true } = {}) {
  const templatePhase = getTemplatePhase(projectType, phaseKey);
  return {
    owner: PHASE_META[phaseKey].owner,
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
              }))
            : [],
        },
        phaseKey,
        stageIndex
      )
    ),
  };
}

function normalizePhaseOrders(project, phaseKey) {
  getPhaseStages(project, phaseKey).forEach((stage, stageIndex) => {
    stage.order = stageIndex;
    stage.sessions.forEach((session, sessionIndex) => {
      session.order = sessionIndex;
      session.phase = phaseKey;
      session.stageKey = stage.key;
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

function buildMigrationCandidates(projectType, phaseKey) {
  const templatePhase = getTemplatePhase(projectType, phaseKey);
  return (templatePhase.stages || []).flatMap((stage) =>
    (stage.sessions || []).map((session) => ({
      stageKey: stage.key,
      key: session.key,
      bodyKey: session.bodyKey || session.key,
      name: session.name,
      duration: session.duration,
      used: false,
    }))
  );
}

function findMigrationCandidate(candidates, predicate) {
  return candidates.find((candidate) => !candidate.used && predicate(candidate)) || null;
}

function migrateLegacyPhase(projectType, phaseKey, legacyPhase = {}) {
  const phase = createPhaseFromTemplate(projectType, phaseKey, { includeSessions: false });
  const candidates = buildMigrationCandidates(projectType, phaseKey);
  const legacySessions = Array.isArray(legacyPhase?.sessions) ? legacyPhase.sessions : [];

  for (const legacySession of legacySessions) {
    const key = migrationSessionLabel(legacySession);
    let match = findMigrationCandidate(candidates, (candidate) => candidate.key && candidate.key === legacySession.key);
    let reason = "matched by key";

    if (!match) {
      match = findMigrationCandidate(
        candidates,
        (candidate) =>
          candidate.bodyKey &&
          candidate.bodyKey === (legacySession.bodyKey || legacySession.key) &&
          candidate.name === legacySession.name
      );
      reason = "matched by bodyKey+name";
    }

    if (!match) {
      match = findMigrationCandidate(
        candidates,
        (candidate) => candidate.name === legacySession.name && Number(candidate.duration) === Number(legacySession.duration)
      );
      reason = "matched by name+duration";
    }

    if (!match) {
      console.info(`[TP migrate] session "${key}" -> unmatched -> manual stage`);
      const manualStage = getOrCreateManualStage(phase, phaseKey);
      manualStage.sessions.push(makeSession({ ...legacySession, phase: phaseKey, stageKey: manualStage.key }, manualStage.sessions.length, phaseKey, manualStage.key));
      continue;
    }

    match.used = true;
    console.info(`[TP migrate] session "${key}" -> ${reason}`);
    const targetStage = phase.stages.find((stage) => stage.key === match.stageKey);
    if (targetStage) {
      targetStage.sessions.push(makeSession({ ...legacySession, phase: phaseKey, stageKey: targetStage.key }, targetStage.sessions.length, phaseKey, targetStage.key));
    }
  }

  normalizePhaseOrders({ phases: { [phaseKey]: phase } }, phaseKey);
  return phase;
}

function normalizeModernPhase(projectType, phaseKey, phase = {}) {
  const templatePhase = getTemplatePhase(projectType, phaseKey);
  const templateStages = new Map((templatePhase.stages || []).map((stage) => [stage.key, stage]));

  const nextPhase = {
    owner: PHASE_META[phaseKey].owner,
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
          })),
        },
        phaseKey,
        index
      );
    }),
  };

  return nextPhase;
}

function normalizePhaseContainer(projectType, phaseKey, phase = null) {
  if (phase?.stages) {
    return normalizeModernPhase(projectType, phaseKey, phase);
  }
  if (phase?.sessions) {
    return migrateLegacyPhase(projectType, phaseKey, phase);
  }
  return createPhaseFromTemplate(projectType, phaseKey);
}

function syncGoLiveSession(project) {
  const found = getAllSessions(project).find((session) => session.key === GO_LIVE_SESSION_KEY);
  if (!found) return;

  found.phase = "implementation";
  found.owner = "is";
  found.lockedDate = true;
  found.date = project.goLiveDate || "";
  found.time = found.time || "08:30";

  const stage = getStageForSession(project, found);
  if (stage) {
    stage.rangeStart = project.goLiveDate || "";
    stage.rangeEnd = project.goLiveDate || "";
  }
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

function getPhaseDates(project, phaseKey) {
  return getPhaseSessions(project, phaseKey)
    .filter((session) => session.date)
    .map((session) => session.date)
    .sort(compareByDate);
}

function getDateAfter(dateString) {
  if (!dateString) return "";
  return toDateStr(addDays(parseDate(dateString), 1));
}

export function createOnboardingDraft(projectType = "manufacturing") {
  const phases = {
    setup: createPhaseFromTemplate(projectType, "setup"),
    implementation: createPhaseFromTemplate(projectType, "implementation"),
    hypercare: createPhaseFromTemplate(projectType, "hypercare"),
  };
  const defaultStageKey = phases.implementation.stages[0]?.key || "";

  return {
    clientName: "",
    projectType,
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
    },
  };
}

export function normalizeProject(project) {
  const nextProject = {
    id: project?.id || uid(),
    clientName: String(project?.clientName || "").trim(),
    projectType: project?.projectType || "manufacturing",
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
      setup: normalizePhaseContainer(project?.projectType || "manufacturing", "setup", project?.phases?.setup || null),
      implementation: normalizePhaseContainer(project?.projectType || "manufacturing", "implementation", project?.phases?.implementation || null),
      hypercare: normalizePhaseContainer(project?.projectType || "manufacturing", "hypercare", project?.phases?.hypercare || null),
    },
    handoff: {
      sentAt: project?.handoff?.sentAt || "",
      delegateUsed: Boolean(project?.handoff?.delegateUsed),
      deepLinkUrl: project?.handoff?.deepLinkUrl || "",
      deepLinkLength: Number(project?.handoff?.deepLinkLength) || 0,
      pendingPmSync: Boolean(project?.handoff?.pendingPmSync),
      eventId: project?.handoff?.eventId || "",
    },
    isCommittedAt: project?.isCommittedAt || "",
    completedAt: project?.completedAt || "",
    closedAt: project?.closedAt || "",
    closedBy: String(project?.closedBy || "").trim(),
    createdAt: project?.createdAt || new Date().toISOString(),
    updatedAt: project?.updatedAt || new Date().toISOString(),
    status: project?.status || "scheduling",
  };

  PHASE_ORDER.forEach((phaseKey) => normalizePhaseOrders(nextProject, phaseKey));
  syncGoLiveSession(nextProject);
  nextProject.status = deriveProjectStatus(nextProject);
  return nextProject;
}

export function cloneProject(project) {
  return normalizeProject(cloneValue(project));
}

export function createProjectFromDraft(draft) {
  return normalizeProject({
    clientName: draft.clientName,
    projectType: draft.projectType,
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
  normalizePhaseOrders(project, phaseKey);
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
        owner: sessionInput.owner || PHASE_META[phaseKey].owner,
        key: sessionInput.key || "",
        bodyKey: sessionInput.bodyKey || sessionInput.key || "",
      },
      stage.sessions.length,
      phaseKey,
      stage.key
    )
  );

  normalizePhaseOrders(project, phaseKey);
  touchProject(project);
  project.status = deriveProjectStatus(project);
  return stage;
}

export function removeSession(project, sessionId) {
  const found = findSession(project, sessionId);
  if (!found) return;

  found.stage.sessions.splice(found.index, 1);
  normalizePhaseOrders(project, found.phaseKey);
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
  normalizePhaseOrders(project, found.phaseKey);
  touchProject(project);
}

export function touchProject(project) {
  project.updatedAt = new Date().toISOString();
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
  const dated = sessions.filter((session) => session.date).map((session) => session.date).sort(compareByDate);
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
  if (!dateString) return true;
  const range = getStageRangeForSession(project, session);
  if (range.start && dateString < range.start) return false;
  if (range.end && dateString > range.end) return false;
  return true;
}

export function isDateWithinPhaseWindow(project, session, dateString) {
  if (!dateString) return true;

  const window = getWindowForPhase(project, session.phase);
  if (window.min && dateString < window.min) return false;
  if (window.max && dateString > window.max) return false;

  if (session.phase === "setup") {
    const implementationDates = getPhaseDates(project, "implementation");
    if (implementationDates[0] && dateString >= implementationDates[0]) return false;
  }

  if (session.phase === "implementation") {
    const setupDates = getPhaseDates(project, "setup");
    if (setupDates.length && dateString <= setupDates[setupDates.length - 1]) return false;
  }

  if (session.phase === "hypercare") {
    const implementationDates = getPhaseDates(project, "implementation");
    if (implementationDates.length && dateString <= implementationDates[implementationDates.length - 1]) return false;
  }

  return true;
}

export function canEditSession(project, session, actor) {
  if (!project || !session || !actor || session.locked) return false;
  if (session.key === GO_LIVE_SESSION_KEY) return actor === "is";
  if (actor === "pm") return true;
  return session.phase === "implementation";
}

export function canCommitSession(session, actor) {
  if (!session || !actor) return false;
  if (session.type === "internal") return false;
  if (actor === "pm") return session.owner === "pm";
  return session.owner === "is";
}

export function getVisiblePhaseKeys(actor) {
  return actor === "is" ? ["implementation"] : [...PHASE_ORDER];
}

export function getContextPhaseKeys(actor) {
  return actor === "is" ? ["setup", "hypercare"] : [];
}

export function getEditableSessions(project, actor) {
  return getAllSessions(project).filter((session) => canEditSession(project, session, actor));
}

export function getConflictReviewSessions(project, actor) {
  return getAllSessions(project).filter(
    (session) =>
      session.owner === actor &&
      session.type !== "internal" &&
      session.date &&
      canEditSession(project, session, actor)
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
  return getAllSessions(project).find((session) => session.key === GO_LIVE_SESSION_KEY) || null;
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
  return project?.pmName || "Project Manager";
}

export function getCalendarOwnerName(project, phaseKey) {
  const owner = phaseKey ? PHASE_META[phaseKey]?.owner : "pm";
  return owner === "is" ? project?.isName || "Implementation Specialist" : project?.pmName || "Project Manager";
}

export function projectHasImplementationReady(project) {
  const sessions = getPhaseSessions(project, "implementation");
  return sessions.length > 0 && sessions.every((session) => session.date && session.time);
}

export function projectHasPendingCommit(project) {
  return deriveProjectStatus(project) === "pending_is_commit";
}

export function projectIsComplete(project) {
  return deriveProjectStatus(project) === "complete";
}

export function projectIsClosed(project) {
  return deriveProjectStatus(project) === "closed";
}

export function deriveProjectStatus(project) {
  const allSessions = getAllSessions(project);
  const setupSessions = getPhaseSessions(project, "setup");
  const implementationSessions = getPhaseSessions(project, "implementation");
  const hypercareSessions = getPhaseSessions(project, "hypercare");
  const implementationCommitted = implementationSessions.length
    ? implementationSessions.every((session) => session.graphActioned || session.type === "internal")
    : false;
  const pmSessionsCommitted = [...setupSessions, ...hypercareSessions].every(
    (session) => session.graphActioned || session.type === "internal"
  );
  const allProjectCommitted = allSessions.every((session) => session.graphActioned || session.type === "internal");

  if (project.closedAt) {
    return "closed";
  }

  if (project.completedAt || (allProjectCommitted && implementationCommitted && pmSessionsCommitted)) {
    return "complete";
  }

  if (project.isCommittedAt || implementationCommitted) {
    return "active";
  }

  if (project.handoff?.sentAt) {
    return "pending_is_commit";
  }

  return "scheduling";
}

export function getProjectCardStatus(project) {
  return STATUS_META[deriveProjectStatus(project)] || STATUS_META.scheduling;
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
  const implSessions = getPhaseSessions(source, "implementation").filter((s) => s.key !== GO_LIVE_SESSION_KEY);
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
    setupMin, setupMax, implMin, implMax, hcMin, hcMax,
    totalMin, totalMax,
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
  const implementationSessions = getPhaseSessions(source, "implementation").filter((session) => session.key !== GO_LIVE_SESSION_KEY);
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

export function mergeDeepLinkProject(existingProject, incomingProject) {
  if (!existingProject) return normalizeProject(incomingProject);

  const merged = normalizeProject({
    ...existingProject,
    ...incomingProject,
    phases: {
      setup: existingProject.phases.setup,
      implementation: incomingProject.phases.implementation,
      hypercare: existingProject.phases.hypercare,
    },
  });

  const existingImplementation = getPhaseSessions(existingProject, "implementation");
  for (const session of getPhaseSessions(merged, "implementation")) {
    const preserved =
      existingImplementation.find((candidate) => candidate.key && candidate.key === session.key) ||
      existingImplementation.find(
        (candidate) =>
          candidate.bodyKey === session.bodyKey &&
          candidate.name === session.name &&
          candidate.duration === session.duration
      ) ||
      existingImplementation.find((candidate) => candidate.name === session.name && candidate.duration === session.duration);

    if (!preserved) continue;
    session.id = preserved.id;
    session.graphEventId = preserved.graphEventId;
    session.graphActioned = preserved.graphActioned;
    session.outlookActioned = preserved.outlookActioned;
  }

  merged.status = deriveProjectStatus(merged);
  return merged;
}

export function serializeSentinelProjects(projects) {
  return projects.map((project) => normalizeProject(project));
}
