export const CALENDAR_OWNER_LABELS = {
  pm: "PM",
  is: "IS",
  shared: "Shared",
};

const PHASE_OWNER_MAP = {
  setup: "pm",
  implementation: "is",
  hypercare: "pm",
};

function buildWarning({
  code = "",
  owner = "",
  phaseKey = "",
  title = "",
  message = "",
  detail = "",
  blocking = true,
  status = 0,
} = {}) {
  return {
    code,
    owner,
    phaseKey,
    title,
    message,
    detail,
    blocking,
    status: Number(status) || 0,
  };
}

function getPhaseCalendarSource(project, phaseKey = "") {
  return project?.phases?.[phaseKey]?.calendarSource
    || project?.phases?.[phaseKey]?.owner
    || PHASE_OWNER_MAP[phaseKey]
    || "pm";
}

export function getCalendarOwnerForPhase(phaseKey = "", project = null) {
  return getPhaseCalendarSource(project, phaseKey);
}

export function createCalendarSourceState(owner, overrides = {}) {
  return {
    owner,
    status: "idle",
    userId: owner === "pm" ? "me" : "",
    mailbox: "",
    loadedAt: "",
    error: "",
    errorCode: "",
    ...overrides,
  };
}

export function createCalendarAvailabilityState(overrides = {}) {
  return {
    projectId: overrides.projectId || "",
    rangeStart: overrides.rangeStart || "",
    rangeEnd: overrides.rangeEnd || "",
    warnings: Array.isArray(overrides.warnings) ? [...overrides.warnings] : [],
    sources: {
      pm: createCalendarSourceState("pm", overrides.sources?.pm || {}),
      is: createCalendarSourceState("is", overrides.sources?.is || {}),
      shared: createCalendarSourceState("shared", overrides.sources?.shared || {}),
    },
  };
}

export function getCalendarSourceState(availability, owner) {
  return availability?.sources?.[owner] || createCalendarSourceState(owner);
}

function getPhaseKeysForOwner(project, owner, { actor = "pm" } = {}) {
  const allPhaseKeys = ["setup", "implementation", "hypercare"];
  const visiblePhaseKeys = actor === "is"
    ? allPhaseKeys.filter((phaseKey) => getCalendarOwnerForPhase(phaseKey, project) === "is")
    : allPhaseKeys;

  return visiblePhaseKeys.filter((phaseKey) => getCalendarOwnerForPhase(phaseKey, project) === owner);
}

export function getCalendarFetchPlan({ project, actor = "pm" } = {}) {
  if (!project) {
    return {
      sources: [],
      warnings: [],
    };
  }

  const sources = [];
  const warnings = [];

  const pmPhaseKeys = getPhaseKeysForOwner(project, "pm", { actor });
  if (pmPhaseKeys.length && actor !== "is") {
    sources.push({
      owner: "pm",
      userId: "me",
      mailbox: String(project.pmEmail || "").trim().toLowerCase(),
      phaseKeys: pmPhaseKeys,
    });
  }

  const isPhaseKeys = getPhaseKeysForOwner(project, "is", { actor });
  if (isPhaseKeys.length) {
    const isEmail = String(project.isEmail || "").trim().toLowerCase();
    if (!isEmail && actor !== "is") {
      warnings.push(
        buildWarning({
          code: "implementation_missing_email",
          owner: "is",
          phaseKey: isPhaseKeys[0],
          title: "Implementation calendar not configured",
          message: "Add the IS email in Project Settings to load implementation availability and conflict checks.",
        })
      );
    } else {
      sources.push({
        owner: "is",
        userId: actor === "is" ? "me" : isEmail,
        mailbox: actor === "is" ? String(project.isEmail || "").trim().toLowerCase() : isEmail,
        phaseKey: isPhaseKeys[0] || "",
        phaseKeys: isPhaseKeys,
      });
    }
  }

  return {
    sources,
    warnings,
  };
}

export function classifyCalendarSourceError({ owner, error, actor = "pm" } = {}) {
  const status = Number(error?.status) || 0;
  const detail = error?.message || String(error || "");
  const ownerLabel = CALENDAR_OWNER_LABELS[owner] || owner.toUpperCase();

  if (owner === "is") {
    if (status === 403 || status === 404) {
      return buildWarning({
        code: status === 403 ? "implementation_share_missing" : "implementation_mailbox_unavailable",
        owner: "is",
        phaseKey: "implementation",
        title: `${ownerLabel} calendar unavailable`,
        message:
          status === 403
            ? "Could not read the IS shared calendar. Ask the IS to share their Outlook calendar with delegate access, then refresh availability."
            : "Could not open the IS calendar. Check the IS email and Outlook calendar share, then refresh availability.",
        detail,
        status,
      });
    }

    return buildWarning({
      code: actor === "is" ? "implementation_calendar_error" : "implementation_shared_calendar_error",
      owner: "is",
      phaseKey: "implementation",
      title: `${ownerLabel} calendar unavailable`,
      message: "Implementation availability and conflict checks are blocked until the IS calendar can be read.",
      detail,
      status,
    });
  }

  return buildWarning({
    code: `${owner}_calendar_error`,
    owner,
    phaseKey: owner === "pm" ? "setup" : "",
    title: `${ownerLabel} calendar unavailable`,
    message: `${ownerLabel} availability and conflict checks are blocked until that calendar can be read.`,
    detail,
    status,
  });
}

export function filterCalendarEventsByOwner(events = [], owner) {
  return (events || []).filter((event) => event.calendarOwner === owner);
}

export function filterCalendarEventsByPhase(events = [], phaseKey, project = null) {
  return filterCalendarEventsByOwner(events, getCalendarOwnerForPhase(phaseKey, project));
}

export function getDayViewExternalOwners({ actor = "pm", project = null } = {}) {
  if (actor === "is") return ["is"];
  const owners = [...new Set(["setup", "implementation", "hypercare"].map((phaseKey) => getCalendarOwnerForPhase(phaseKey, project)))];
  return owners.length ? owners : ["pm", "is"];
}

export function getCalendarSourceReadiness({ availability, owner, projectId, requiredRange } = {}) {
  const source = getCalendarSourceState(availability, owner);
  if (!availability || !projectId) {
    return { ready: false, reason: "not_loaded", source };
  }
  if (availability.projectId !== projectId) {
    return { ready: false, reason: "project_mismatch", source };
  }
  if (source.status !== "ready") {
    return {
      ready: false,
      reason: source.status === "blocked" ? "blocked" : source.status === "error" ? "error" : "not_loaded",
      source,
    };
  }
  if (
    requiredRange?.start
    && requiredRange?.end
    && (availability.rangeStart > requiredRange.start || availability.rangeEnd < requiredRange.end)
  ) {
    return { ready: false, reason: "range_mismatch", source };
  }
  return { ready: true, reason: "", source };
}
