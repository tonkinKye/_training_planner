export const CALENDAR_OWNER_LABELS = {
  pm: "PM",
  is: "IS",
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

export function getCalendarOwnerForPhase(phaseKey = "") {
  return PHASE_OWNER_MAP[phaseKey] || "pm";
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
    },
  };
}

export function getCalendarSourceState(availability, owner) {
  return availability?.sources?.[owner] || createCalendarSourceState(owner);
}

export function getCalendarFetchPlan({ project, actor = "pm" } = {}) {
  if (!project) {
    return {
      sources: [],
      warnings: [],
    };
  }

  if (actor === "is") {
    return {
      sources: [
        {
          owner: "is",
          userId: "me",
          mailbox: String(project.isEmail || "").trim().toLowerCase(),
          phaseKey: "implementation",
        },
      ],
      warnings: [],
    };
  }

  const isEmail = String(project.isEmail || "").trim().toLowerCase();
  const sources = [
    {
      owner: "pm",
      userId: "me",
      mailbox: String(project.pmEmail || "").trim().toLowerCase(),
      phaseKeys: ["setup", "hypercare"],
    },
  ];

  if (!isEmail) {
    return {
      sources,
      warnings: [
        buildWarning({
          code: "implementation_missing_email",
          owner: "is",
          phaseKey: "implementation",
          title: "Implementation calendar not configured",
          message: "Add the IS email in Project Settings to load implementation availability and conflict checks.",
        }),
      ],
    };
  }

  sources.push({
    owner: "is",
    userId: isEmail,
    mailbox: isEmail,
    phaseKeys: ["implementation"],
  });

  return {
    sources,
    warnings: [],
  };
}

export function classifyCalendarSourceError({ owner, error, actor = "pm", project } = {}) {
  const status = Number(error?.status) || 0;
  const detail = error?.message || String(error || "");

  if (owner === "is") {
    if (status === 403 || status === 404) {
      return buildWarning({
        code: status === 403 ? "implementation_share_missing" : "implementation_mailbox_unavailable",
        owner: "is",
        phaseKey: "implementation",
        title: "Implementation calendar unavailable",
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
      title: "Implementation calendar unavailable",
      message: "Implementation availability and conflict checks are blocked until the IS calendar can be read.",
      detail,
      status,
    });
  }

  return buildWarning({
    code: "pm_calendar_error",
    owner: "pm",
    phaseKey: "setup",
    title: "PM calendar unavailable",
    message: "Setup and hypercare availability and conflict checks are blocked until the PM calendar can be read.",
    detail,
    status,
  });
}

export function filterCalendarEventsByOwner(events = [], owner) {
  return (events || []).filter((event) => event.calendarOwner === owner);
}

export function filterCalendarEventsByPhase(events = [], phaseKey) {
  return filterCalendarEventsByOwner(events, getCalendarOwnerForPhase(phaseKey));
}

export function getDayViewExternalOwners({ actor = "pm", reviewSession = null } = {}) {
  if (actor === "is") return ["is"];
  if (reviewSession?.phase) return [getCalendarOwnerForPhase(reviewSession.phase)];
  return ["pm", "is"];
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
