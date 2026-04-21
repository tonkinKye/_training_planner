import { normalizeProject } from "./projects.js";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function buildSessionRecord(session = {}, { identityOnly = false } = {}) {
  return {
    id: session.id || "",
    key: session.key || "",
    bodyKey: session.bodyKey ?? null,
    name: session.name || "",
    duration: Number(session.durationMinutes ?? session.duration) || 90,
    phase: session.phase || "",
    stageKey: session.stageKey || "",
    owner: session.owner || "",
    type: session.type || "external",
    order: Number.isFinite(session.order) ? Number(session.order) : 0,
    phaseOrder: Number.isFinite(session.phaseOrder) ? Number(session.phaseOrder) : 0,
    grandOrder: Number.isFinite(session.grandOrder) ? Number(session.grandOrder) : 0,
    gating: session.gating || null,
    calendarSource: session.calendarSource || "",
    date: identityOnly ? "" : session.date || "",
    time: identityOnly ? "" : session.time || "",
    lastKnownStart: identityOnly ? "" : session.lastKnownStart || "",
    lastKnownEnd: identityOnly ? "" : session.lastKnownEnd || "",
    graphEventId: identityOnly ? "" : session.graphEventId || "",
    graphActioned: identityOnly ? false : Boolean(session.graphActioned),
    outlookActioned: identityOnly ? false : Boolean(session.outlookActioned),
    locked: Boolean(session.locked),
    lockedDate: Boolean(session.lockedDate),
    lockedTime: Boolean(session.lockedTime),
    availabilityConflict: identityOnly ? false : Boolean(session.availabilityConflict),
  };
}

function buildStageRecord(stage = {}, options = {}) {
  return {
    key: stage.key || "",
    label: stage.label || "",
    order: Number.isFinite(stage.order) ? Number(stage.order) : 0,
    rangeStart: options.identityOnly ? "" : stage.rangeStart || "",
    rangeEnd: options.identityOnly ? "" : stage.rangeEnd || "",
    sessions: (stage.sessions || []).map((session) => buildSessionRecord(session, options)),
  };
}

function buildPhaseRecord(phase = {}, options = {}) {
  return {
    key: phase.key || "",
    label: phase.label || "",
    owner: phase.owner || "",
    ownerLabel: phase.ownerLabel || "",
    calendarSource: phase.calendarSource || "",
    durationWeeks: phase.durationWeeks || { min: null, max: null },
    suggestedWeeksMin: Number.isFinite(phase.suggestedWeeksMin) ? Number(phase.suggestedWeeksMin) : null,
    suggestedWeeksMax: Number.isFinite(phase.suggestedWeeksMax) ? Number(phase.suggestedWeeksMax) : null,
    stages: (phase.stages || []).map((stage) => buildStageRecord(stage, options)),
  };
}

export function projectPerspectiveForMailbox(project = {}, mailbox = "") {
  const normalizedMailbox = normalizeEmail(mailbox);
  if (!normalizedMailbox) return "pm";
  if (normalizeEmail(project.isEmail) === normalizedMailbox) return "is";
  if (normalizeEmail(project.pmEmail) === normalizedMailbox) return "pm";
  return "pm";
}

function shouldWritePmSparseImplementation(project = {}, perspective = "pm") {
  return perspective === "pm" && Boolean(project.handoff?.sentAt);
}

export function buildSentinelProjectRecord(project = {}, { perspective = "pm" } = {}) {
  const sparseImplementation = shouldWritePmSparseImplementation(project, perspective);
  return {
    id: project.id || "",
    clientName: project.clientName || "",
    projectType: project.projectType || "",
    templateKey: project.templateKey || "",
    templateLabel: project.templateLabel || "",
    templateCustomized: Boolean(project.templateCustomized),
    templateOriginKey: project.templateOriginKey || "",
    templateSnapshot: project.templateSnapshot || null,
    pmName: project.pmName || "",
    pmEmail: project.pmEmail || "",
    isName: project.isName || "",
    isEmail: project.isEmail || "",
    projectStart: project.projectStart || "",
    implementationStart: project.implementationStart || "",
    goLiveDate: project.goLiveDate || "",
    hypercareDuration: project.hypercareDuration || "1 week",
    smartFillPreference: project.smartFillPreference || "none",
    workingDays: Array.isArray(project.workingDays) ? [...project.workingDays] : [],
    location: project.location || "",
    invitees: Array.isArray(project.invitees) ? [...project.invitees] : [],
    phases: {
      setup: buildPhaseRecord(project.phases?.setup || {}),
      implementation: buildPhaseRecord(project.phases?.implementation || {}, {
        identityOnly: sparseImplementation,
      }),
      hypercare: buildPhaseRecord(project.phases?.hypercare || {}),
    },
    handoff: {
      sentAt: project.handoff?.sentAt || "",
      delegateUsed: Boolean(project.handoff?.delegateUsed),
      deepLinkUrl: project.handoff?.deepLinkUrl || "",
      deepLinkLength: Number(project.handoff?.deepLinkLength) || 0,
      eventId: project.handoff?.eventId || "",
    },
    reconciliation: {
      state: project.reconciliation?.state || project.reconciliationState || "not_applicable",
      lastAttemptedAt: project.reconciliation?.lastAttemptedAt || "",
      lastSuccessfulAt: project.reconciliation?.lastSuccessfulAt || "",
      lastFailureAt: project.reconciliation?.lastFailureAt || "",
      lastFailureMessage: project.reconciliation?.lastFailureMessage || "",
    },
    lifecycleState: project.lifecycleState || "",
    reconciliationState: project.reconciliationState || project.reconciliation?.state || "not_applicable",
    isCommittedAt: sparseImplementation ? "" : project.isCommittedAt || "",
    completedAt: sparseImplementation ? "" : project.completedAt || "",
    closedAt: project.closedAt || "",
    closedBy: project.closedBy || "",
    createdAt: project.createdAt || "",
    updatedAt: project.updatedAt || "",
  };
}

export function serializeProjectsForSentinel(projects = [], { mailbox = "", perspective = "" } = {}) {
  return (projects || []).map((project) =>
    buildSentinelProjectRecord(project, {
      perspective: perspective || projectPerspectiveForMailbox(project, mailbox),
    })
  );
}

function projectFromV2Record(record = {}) {
  return normalizeProject({
    id: record.id,
    clientName: record.clientName,
    projectType: record.projectType,
    templateKey: record.templateKey,
    templateLabel: record.templateLabel,
    templateCustomized: record.templateCustomized,
    templateOriginKey: record.templateOriginKey,
    templateSnapshot: record.templateSnapshot || null,
    pmName: record.pmName,
    pmEmail: record.pmEmail,
    isName: record.isName,
    isEmail: record.isEmail,
    projectStart: record.projectStart,
    implementationStart: record.implementationStart,
    goLiveDate: record.goLiveDate,
    hypercareDuration: record.hypercareDuration,
    smartFillPreference: record.smartFillPreference,
    workingDays: record.workingDays,
    location: record.location,
    invitees: record.invitees,
    phases: record.phases || {},
    handoff: record.handoff || {},
    reconciliation: record.reconciliation || {},
    lifecycleState: record.lifecycleState || "",
    reconciliationState: record.reconciliationState || record.reconciliation?.state || "",
    isCommittedAt: record.isCommittedAt,
    completedAt: record.completedAt,
    closedAt: record.closedAt,
    closedBy: record.closedBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export function createSentinelPayload(projects = [], options = {}) {
  const now = new Date().toISOString();
  return {
    version: 2,
    updatedAt: now,
    projects: serializeProjectsForSentinel(projects, options),
  };
}

export function parseSentinelProjects(extension) {
  if (!extension) return [];

  let parsed = extension;
  if (typeof extension.payload === "string") {
    parsed = JSON.parse(extension.payload);
  } else if (Number(extension.version) >= 2) {
    parsed = extension;
  } else if (Array.isArray(extension.projects)) {
    parsed = {
      version: 1,
      projects: extension.projects,
    };
  }

  if (!Array.isArray(parsed?.projects)) {
    throw new Error("Sentinel payload is missing a valid projects array.");
  }

  if (Number(parsed.version) >= 2) {
    return parsed.projects.map((project) => projectFromV2Record(project));
  }

  return parsed.projects.map((project) => {
    const legacyProject = {
      ...project,
      lifecycleState: "",
      reconciliationState: "",
      reconciliation: null,
    };
    return normalizeProject(legacyProject);
  });
}
