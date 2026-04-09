import { GO_LIVE_ANCHOR, getTemplateSessions } from "./session-templates.js";
import { parseDate, toDateStr } from "./utils.js";
import { uid } from "./state.js";

export const PHASE_ORDER = ["setup", "implementation", "hypercare"];

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
};

export function createOnboardingDraft() {
  return {
    clientName: "",
    projectType: "manufacturing",
    pmName: "",
    pmEmail: "",
    isName: "",
    isEmail: "",
    implementationStart: "",
    goLiveDate: "",
    hypercareDuration: "1 week",
    smartFillPreference: "none",
    invitees: "",
    location: "",
    sessions: getTemplateSessions("manufacturing"),
    customSession: {
      phase: "implementation",
      owner: "is",
      name: "",
      duration: 90,
      type: "external",
    },
  };
}

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

function addDays(date, amount) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function makeSession(definition, index) {
  return {
    id: definition?.id || uid(),
    key: definition?.key || "",
    bodyKey: definition?.bodyKey || definition?.key || "",
    name: String(definition?.name || "").trim(),
    duration: Number(definition?.duration) || 90,
    phase: definition?.phase || "implementation",
    owner: definition?.owner || PHASE_META[definition?.phase || "implementation"].owner,
    type: definition?.type || "external",
    order: Number.isFinite(definition?.order) ? Number(definition.order) : index,
    date: definition?.date || "",
    time: definition?.time || "",
    graphEventId: definition?.graphEventId || "",
    graphActioned: Boolean(definition?.graphActioned),
    outlookActioned: Boolean(definition?.outlookActioned),
    locked: Boolean(definition?.locked),
    availabilityConflict: Boolean(definition?.availabilityConflict),
  };
}

function ensurePhaseContainer(project, phaseKey) {
  if (!project.phases[phaseKey]) {
    project.phases[phaseKey] = {
      owner: PHASE_META[phaseKey].owner,
      sessions: [],
    };
  }

  project.phases[phaseKey].owner = PHASE_META[phaseKey].owner;
  project.phases[phaseKey].sessions = (project.phases[phaseKey].sessions || [])
    .map((session, index) => makeSession({ ...session, phase: phaseKey }, index))
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
}

function normalizePhaseOrders(project, phaseKey) {
  getPhaseSessions(project, phaseKey).forEach((session, index) => {
    session.order = index;
  });
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
    implementationStart: project?.implementationStart || "",
    goLiveDate: project?.goLiveDate || "",
    hypercareDuration: ensureHypercareDuration(project?.hypercareDuration),
    smartFillPreference: ensureSmartFillPreference(project?.smartFillPreference),
    location: String(project?.location || "").trim(),
    invitees: normalizeInvitees(project?.invitees),
    phases: {
      setup: project?.phases?.setup || { owner: "pm", sessions: [] },
      implementation: project?.phases?.implementation || { owner: "is", sessions: [] },
      hypercare: project?.phases?.hypercare || { owner: "pm", sessions: [] },
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
    createdAt: project?.createdAt || new Date().toISOString(),
    updatedAt: project?.updatedAt || new Date().toISOString(),
    status: project?.status || "scheduling",
  };

  PHASE_ORDER.forEach((phaseKey) => ensurePhaseContainer(nextProject, phaseKey));
  nextProject.status = deriveProjectStatus(nextProject);
  return nextProject;
}

export function cloneProject(project) {
  return normalizeProject(
    typeof structuredClone === "function"
      ? structuredClone(project)
      : JSON.parse(JSON.stringify(project))
  );
}

export function createProjectFromDraft(draft) {
  const phases = {
    setup: { owner: "pm", sessions: [] },
    implementation: { owner: "is", sessions: [] },
    hypercare: { owner: "pm", sessions: [] },
  };

  (draft.sessions || []).forEach((session, index) => {
    const nextSession = makeSession(session, index);
    phases[nextSession.phase].sessions.push(nextSession);
  });

  return normalizeProject({
    clientName: draft.clientName,
    projectType: draft.projectType,
    pmName: draft.pmName,
    pmEmail: draft.pmEmail,
    isName: draft.isName,
    isEmail: draft.isEmail,
    implementationStart: draft.implementationStart,
    goLiveDate: draft.goLiveDate,
    hypercareDuration: draft.hypercareDuration,
    smartFillPreference: draft.smartFillPreference,
    location: draft.location,
    invitees: draft.invitees,
    phases,
  });
}

export function getProjectById(projects, projectId) {
  return projects.find((project) => project.id === projectId) || null;
}

export function getPhaseSessions(project, phaseKey) {
  return project?.phases?.[phaseKey]?.sessions || [];
}

export function getAllSessions(project) {
  return PHASE_ORDER.flatMap((phaseKey) => getPhaseSessions(project, phaseKey));
}

export function findSession(project, sessionId) {
  for (const phaseKey of PHASE_ORDER) {
    const sessions = getPhaseSessions(project, phaseKey);
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index >= 0) {
      return {
        phaseKey,
        index,
        session: sessions[index],
      };
    }
  }

  return null;
}

export function addCustomSession(project, sessionInput) {
  const phaseKey = sessionInput.phase || "implementation";
  const sessions = getPhaseSessions(project, phaseKey);
  sessions.push(
    makeSession(
      {
        ...sessionInput,
        phase: phaseKey,
        owner: sessionInput.owner || PHASE_META[phaseKey].owner,
        key: sessionInput.key || "",
        bodyKey: sessionInput.bodyKey || "",
      },
      sessions.length
    )
  );
  normalizePhaseOrders(project, phaseKey);
  touchProject(project);
  project.status = deriveProjectStatus(project);
}

export function removeSession(project, sessionId) {
  const found = findSession(project, sessionId);
  if (!found) return;

  project.phases[found.phaseKey].sessions.splice(found.index, 1);
  normalizePhaseOrders(project, found.phaseKey);
  touchProject(project);
  project.status = deriveProjectStatus(project);
}

export function moveSession(project, sessionId, direction) {
  const found = findSession(project, sessionId);
  if (!found) return;

  const sessions = project.phases[found.phaseKey].sessions;
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
  const dated = getPhaseSessions(project, phaseKey)
    .filter((session) => session.date)
    .map((session) => session.date)
    .sort();

  if (!dated.length) return "";
  if (dated.length === 1) return dated[0];
  return `${dated[0]}:${dated[dated.length - 1]}`;
}

export function getPhaseSummary(project, phaseKey) {
  const sessions = getPhaseSessions(project, phaseKey);
  const scheduled = sessions.filter((session) => session.date && session.time).length;
  const dated = sessions.filter((session) => session.date).map((session) => session.date).sort();

  return {
    total: sessions.length,
    scheduled,
    rangeStart: dated[0] || "",
    rangeEnd: dated[dated.length - 1] || "",
  };
}

export function getWindowForPhase(project, phaseKey) {
  if (phaseKey === "setup") {
    return {
      min: "",
      max: project.implementationStart ? toDateStr(addDays(parseDate(project.implementationStart), -1)) : "",
    };
  }

  if (phaseKey === "implementation") {
    return {
      min: project.implementationStart || "",
      max: project.goLiveDate ? toDateStr(addDays(parseDate(project.goLiveDate), -1)) : "",
    };
  }

  if (phaseKey === "hypercare") {
    const start = project.goLiveDate || "";
    const weeks = ensureHypercareDuration(project.hypercareDuration) === "2 weeks" ? 14 : 7;
    return {
      min: start,
      max: start ? toDateStr(addDays(parseDate(start), weeks - 1)) : "",
    };
  }

  return { min: "", max: "" };
}

export function isDateWithinPhaseWindow(project, session, dateString) {
  if (!dateString) return true;

  const window = getWindowForPhase(project, session.phase);
  if (window.min && dateString < window.min) return false;
  if (window.max && dateString > window.max) return false;
  return true;
}

export function canEditSession(project, session, actor) {
  if (!project || !session || !actor || session.locked) return false;
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
  return {
    ...GO_LIVE_ANCHOR,
    date: project.goLiveDate || "",
  };
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
  return getPhaseSessions(project, "implementation").every((session) => session.date && session.time);
}

export function projectHasPendingCommit(project) {
  return deriveProjectStatus(project) === "pending_is_commit";
}

export function projectIsComplete(project) {
  return deriveProjectStatus(project) === "complete";
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
    .sort();
  const windowStart = datedSessions[0] || project.implementationStart || toDateStr(new Date());
  const hypercareWindow = getWindowForPhase(project, "hypercare");
  const windowEnd = hypercareWindow.max || project.goLiveDate || datedSessions[datedSessions.length - 1] || windowStart;
  return {
    start: windowStart,
    end: windowEnd,
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
  merged.phases.implementation.sessions = getPhaseSessions(merged, "implementation").map((session, index) => {
    const preserved =
      existingImplementation.find((candidate) => candidate.key && candidate.key === session.key) ||
      existingImplementation.find((candidate) => candidate.name === session.name && candidate.duration === session.duration);

    return makeSession(
      {
        ...session,
        id: preserved?.id || session.id,
        graphEventId: preserved?.graphEventId || session.graphEventId,
        graphActioned: preserved?.graphActioned || session.graphActioned,
        outlookActioned: preserved?.outlookActioned || session.outlookActioned,
      },
      index
    );
  });

  merged.status = deriveProjectStatus(merged);
  return merged;
}

export function serializeSentinelProjects(projects) {
  return projects.map((project) => normalizeProject(project));
}
