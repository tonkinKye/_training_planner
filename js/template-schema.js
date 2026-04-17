import { SESSION_BODIES } from "./session-bodies.js";

export const CANONICAL_PHASE_ORDER = ["setup", "implementation", "hypercare"];
export const VALID_OWNERS = new Set(["pm", "is", "shared"]);
export const VALID_SESSION_TYPES = new Set(["internal", "external"]);
export const VALID_CALENDAR_SOURCES = new Set(["pm", "is", "shared"]);
export const VALID_GATING_TYPES = new Set(["phase_gate", "predecessor"]);

export const DEFAULT_PHASE_DEFINITIONS = {
  setup: {
    label: "Setup",
    owner: "pm",
    calendarSource: "pm",
    durationWeeks: { min: null, max: null },
  },
  implementation: {
    label: "Implementation",
    owner: "is",
    calendarSource: "is",
    durationWeeks: { min: null, max: null },
  },
  hypercare: {
    label: "Hypercare",
    owner: "pm",
    calendarSource: "pm",
    durationWeeks: { min: null, max: null },
  },
};

export function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function asTrimmedString(value) {
  return String(value || "").trim();
}

function asNullableString(value) {
  const normalized = asTrimmedString(value);
  return normalized || "";
}

function toNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDurationWeeks(value, fallback = {}) {
  if (Number.isFinite(Number(value))) {
    const fixed = Number(value);
    return { min: fixed, max: fixed };
  }

  const min = toNullableNumber(value?.min);
  const max = toNullableNumber(value?.max);
  return {
    min,
    max: max ?? min ?? fallback.max ?? null,
  };
}

function normalizeMetadata(metadata = {}) {
  const next = {};
  Object.keys(metadata || {})
    .sort((left, right) => left.localeCompare(right))
    .forEach((key) => {
      if (metadata[key] != null && metadata[key] !== "") {
        next[key] = metadata[key];
      }
    });
  return next;
}

function createIssue(severity, path, message, code = "") {
  return {
    severity,
    code,
    path,
    message,
  };
}

function validateDuration(durationWeeks, path, issues) {
  const min = durationWeeks.min;
  const max = durationWeeks.max;
  if (min != null && min < 0) {
    issues.push(createIssue("error", `${path}.min`, "Minimum duration cannot be negative.", "phase_duration_min"));
  }
  if (max != null && max < 0) {
    issues.push(createIssue("error", `${path}.max`, "Maximum duration cannot be negative.", "phase_duration_max"));
  }
  if (min != null && max != null && max < min) {
    issues.push(createIssue("error", path, "Maximum duration cannot be less than minimum duration.", "phase_duration_range"));
  }
}

function validatePhaseShape(phase, path, issues) {
  const hasStages = Array.isArray(phase?.stages);
  const hasSessions = Array.isArray(phase?.sessions);
  if (hasStages && hasSessions && phase.sessions.length && phase.stages.length) {
    issues.push(createIssue("error", path, "A phase cannot define both stages and direct sessions.", "phase_shape"));
  }
}

function validateSessionGating(template, issues) {
  const normalized = normalizeTemplate(template);
  for (const phase of normalized.phases) {
    const phaseGateSessions = phase.sessions.filter((session) => session.gating?.type === "phase_gate");
    if (phaseGateSessions.length > 1) {
      phaseGateSessions.forEach((session) => {
        issues.push(
          createIssue(
            "warning",
            `phases.${phase.key}.sessions.${session.key}.gating`,
            "Only one phase_gate is expected per phase in v1.",
            "phase_gate_multiple"
          )
        );
      });
    }

    const sessionKeys = new Set(phase.sessions.map((session) => session.key));
    for (const session of phase.sessions) {
      if (session.gating?.type === "predecessor") {
        const ref = asTrimmedString(session.gating.ref);
        if (!ref) {
          issues.push(
            createIssue(
              "error",
              `phases.${phase.key}.sessions.${session.key}.gating.ref`,
              "Predecessor gating requires a ref value.",
              "gating_predecessor_ref"
            )
          );
          continue;
        }
        if (!sessionKeys.has(ref)) {
          issues.push(
            createIssue(
              "error",
              `phases.${phase.key}.sessions.${session.key}.gating.ref`,
              `Predecessor ref "${ref}" does not exist in phase "${phase.key}".`,
              "gating_predecessor_missing"
            )
          );
        }
        if (ref === session.key) {
          issues.push(
            createIssue(
              "error",
              `phases.${phase.key}.sessions.${session.key}.gating.ref`,
              "A session cannot depend on itself.",
              "gating_self_ref"
            )
          );
        }
      }
    }
  }
}

export function validateTemplate(template) {
  const issues = [];
  const key = asTrimmedString(template?.key);
  const label = asTrimmedString(template?.label);
  const phases = Array.isArray(template?.phases) ? template.phases : [];

  if (!key) {
    issues.push(createIssue("error", "key", "Template key is required.", "template_key"));
  }
  if (!label) {
    issues.push(createIssue("error", "label", "Template label is required.", "template_label"));
  }
  if (phases.length !== CANONICAL_PHASE_ORDER.length) {
    issues.push(
      createIssue(
        "error",
        "phases",
        `Templates in v1 must define exactly ${CANONICAL_PHASE_ORDER.length} canonical phases.`,
        "template_phase_count"
      )
    );
  }

  const seenPhaseKeys = new Set();
  const seenStageKeys = new Set();
  const seenSessionKeys = new Set();

  phases.forEach((phase, phaseIndex) => {
    const path = `phases[${phaseIndex}]`;
    const phaseKey = asTrimmedString(phase?.key);
    const canonicalKey = CANONICAL_PHASE_ORDER[phaseIndex];
    const phaseDefaults = DEFAULT_PHASE_DEFINITIONS[canonicalKey] || DEFAULT_PHASE_DEFINITIONS.setup;

    if (!phaseKey) {
      issues.push(createIssue("error", `${path}.key`, "Phase key is required.", "phase_key"));
    } else if (seenPhaseKeys.has(phaseKey)) {
      issues.push(createIssue("error", `${path}.key`, `Duplicate phase key "${phaseKey}".`, "phase_duplicate"));
    } else {
      seenPhaseKeys.add(phaseKey);
    }

    if (phaseKey && canonicalKey && phaseKey !== canonicalKey) {
      issues.push(
        createIssue(
          "error",
          `${path}.key`,
          `Phase ${phaseIndex + 1} must be "${canonicalKey}" in v1.`,
          "phase_order"
        )
      );
    }

    if (!asTrimmedString(phase?.label)) {
      issues.push(createIssue("error", `${path}.label`, "Phase label is required.", "phase_label"));
    }

    if (phase?.owner && !VALID_OWNERS.has(phase.owner)) {
      issues.push(createIssue("error", `${path}.owner`, `Invalid phase owner "${phase.owner}".`, "phase_owner"));
    }

    if (phase?.calendarSource && !VALID_CALENDAR_SOURCES.has(phase.calendarSource)) {
      issues.push(
        createIssue("error", `${path}.calendarSource`, `Invalid calendarSource "${phase.calendarSource}".`, "phase_calendar")
      );
    }

    validateDuration(normalizeDurationWeeks(phase?.durationWeeks, phaseDefaults.durationWeeks), `${path}.durationWeeks`, issues);
    validatePhaseShape(phase, path, issues);

    const stages = Array.isArray(phase?.stages) ? phase.stages : [];
    const directSessions = Array.isArray(phase?.sessions) ? phase.sessions : [];
    const normalizedStages = stages.length
      ? stages
      : [
          {
            key: `${phaseKey || canonicalKey || "phase"}_stage_1`,
            label: asTrimmedString(phase?.label) || phaseDefaults.label,
            sessions: directSessions,
          },
        ];

    normalizedStages.forEach((stage, stageIndex) => {
      const stagePath = `${path}.stages[${stageIndex}]`;
      const stageKey = asTrimmedString(stage?.key);
      if (!stageKey) {
        issues.push(createIssue("error", `${stagePath}.key`, "Stage key is required.", "stage_key"));
      } else if (seenStageKeys.has(stageKey)) {
        issues.push(createIssue("error", `${stagePath}.key`, `Duplicate stage key "${stageKey}".`, "stage_duplicate"));
      } else {
        seenStageKeys.add(stageKey);
      }

      if (!asTrimmedString(stage?.label)) {
        issues.push(createIssue("error", `${stagePath}.label`, "Stage label is required.", "stage_label"));
      }

      (Array.isArray(stage?.sessions) ? stage.sessions : []).forEach((session, sessionIndex) => {
        const sessionPath = `${stagePath}.sessions[${sessionIndex}]`;
        const sessionKey = asTrimmedString(session?.key);
        if (!sessionKey) {
          issues.push(createIssue("error", `${sessionPath}.key`, "Session key is required.", "session_key"));
        } else if (seenSessionKeys.has(sessionKey)) {
          issues.push(
            createIssue("error", `${sessionPath}.key`, `Duplicate session key "${sessionKey}".`, "session_duplicate")
          );
        } else {
          seenSessionKeys.add(sessionKey);
        }

        if (!asTrimmedString(session?.name)) {
          issues.push(createIssue("error", `${sessionPath}.name`, "Session name is required.", "session_name"));
        }
        if (!Number.isFinite(Number(session?.durationMinutes)) || Number(session.durationMinutes) <= 0) {
          issues.push(
            createIssue(
              "error",
              `${sessionPath}.durationMinutes`,
              "Session durationMinutes must be a positive number.",
              "session_duration"
            )
          );
        }
        if (session?.owner && !VALID_OWNERS.has(session.owner)) {
          issues.push(createIssue("error", `${sessionPath}.owner`, `Invalid owner "${session.owner}".`, "session_owner"));
        }
        if (session?.type && !VALID_SESSION_TYPES.has(session.type)) {
          issues.push(createIssue("error", `${sessionPath}.type`, `Invalid type "${session.type}".`, "session_type"));
        }
        if (session?.gating?.type && !VALID_GATING_TYPES.has(session.gating.type)) {
          issues.push(
            createIssue(
              "error",
              `${sessionPath}.gating.type`,
              `Invalid gating type "${session.gating.type}".`,
              "session_gating_type"
            )
          );
        }
        if (session?.bodyKey != null && session.bodyKey !== "" && !SESSION_BODIES[session.bodyKey]) {
          issues.push(
            createIssue(
              "warning",
              `${sessionPath}.bodyKey`,
              `bodyKey "${session.bodyKey}" does not exist in session-bodies.js.`,
              "session_body_key"
            )
          );
        }
      });
    });
  });

  validateSessionGating(template, issues);

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    errors: issues.filter((issue) => issue.severity === "error"),
    warnings: issues.filter((issue) => issue.severity === "warning"),
    issues,
  };
}

function normalizeGating(gating) {
  if (!gating || !VALID_GATING_TYPES.has(gating.type)) return null;
  if (gating.type === "phase_gate") {
    return { type: "phase_gate" };
  }
  const ref = asTrimmedString(gating.ref);
  return {
    type: "predecessor",
    ref,
  };
}

function normalizeSession(rawSession, phase, stage, sessionOrder, phaseOrder, grandOrder) {
  const key = asTrimmedString(rawSession?.key);
  const bodyKey = rawSession?.bodyKey === undefined
    ? key || null
    : rawSession?.bodyKey === null
      ? null
      : asTrimmedString(rawSession.bodyKey) || null;

  return {
    key,
    name: asTrimmedString(rawSession?.name),
    durationMinutes: Number(rawSession?.durationMinutes) || 90,
    duration: Number(rawSession?.durationMinutes) || 90,
    type: VALID_SESSION_TYPES.has(rawSession?.type) ? rawSession.type : "external",
    owner: VALID_OWNERS.has(rawSession?.owner) ? rawSession.owner : phase.owner,
    bodyKey,
    locked: Boolean(rawSession?.locked),
    lockedDate: Boolean(rawSession?.locked),
    lockedTime: false,
    gating: normalizeGating(rawSession?.gating),
    phase: phase.key,
    phaseKey: phase.key,
    stageKey: stage.key,
    stageLabel: stage.label,
    order: sessionOrder,
    phaseOrder,
    stageOrder: stage.order,
    grandOrder,
    calendarSource: phase.calendarSource,
  };
}

function normalizeStage(rawStage, phase, stageOrder, phaseSessionOffset, grandOrderStart) {
  const stageKey = asTrimmedString(rawStage?.key) || `${phase.key}_stage_${stageOrder + 1}`;
  const stageLabel = asTrimmedString(rawStage?.label) || `Stage ${stageOrder + 1}`;
  let phaseOrder = phaseSessionOffset;
  let grandOrder = grandOrderStart;
  const sessions = (Array.isArray(rawStage?.sessions) ? rawStage.sessions : []).map((rawSession, sessionOrder) => {
    const next = normalizeSession(
      rawSession,
      phase,
      { key: stageKey, label: stageLabel, order: stageOrder },
      sessionOrder,
      phaseOrder,
      grandOrder
    );
    phaseOrder += 1;
    grandOrder += 1;
    return next;
  });

  return {
    key: stageKey,
    label: stageLabel,
    order: stageOrder,
    rangeStart: "",
    rangeEnd: "",
    sessions,
  };
}

function normalizePhase(rawPhase, phaseOrder, grandOrderStart) {
  const defaults = DEFAULT_PHASE_DEFINITIONS[CANONICAL_PHASE_ORDER[phaseOrder]] || DEFAULT_PHASE_DEFINITIONS.setup;
  const key = asTrimmedString(rawPhase?.key) || CANONICAL_PHASE_ORDER[phaseOrder] || `phase_${phaseOrder + 1}`;
  const owner = VALID_OWNERS.has(rawPhase?.owner) ? rawPhase.owner : defaults.owner;
  const calendarSource = VALID_CALENDAR_SOURCES.has(rawPhase?.calendarSource)
    ? rawPhase.calendarSource
    : owner === "shared"
      ? defaults.calendarSource
      : owner;
  const phase = {
    key,
    label: asTrimmedString(rawPhase?.label) || defaults.label,
    order: phaseOrder,
    owner,
    ownerLabel: owner === "is" ? "IS" : owner === "shared" ? "Shared" : "PM",
    calendarSource,
    durationWeeks: normalizeDurationWeeks(rawPhase?.durationWeeks, defaults.durationWeeks),
    suggestedWeeksMin: normalizeDurationWeeks(rawPhase?.durationWeeks, defaults.durationWeeks).min,
    suggestedWeeksMax: normalizeDurationWeeks(rawPhase?.durationWeeks, defaults.durationWeeks).max,
    stages: [],
    sessions: [],
  };

  const rawStages = Array.isArray(rawPhase?.stages)
    ? rawPhase.stages
    : [
        {
          key: `${key}_stage_1`,
          label: phase.label,
          sessions: Array.isArray(rawPhase?.sessions) ? rawPhase.sessions : [],
        },
      ];

  let phaseSessionOffset = 0;
  let grandOrder = grandOrderStart;
  phase.stages = rawStages.map((rawStage, stageOrder) => {
    const stage = normalizeStage(rawStage, phase, stageOrder, phaseSessionOffset, grandOrder);
    phaseSessionOffset += stage.sessions.length;
    grandOrder += stage.sessions.length;
    return stage;
  });
  phase.sessions = phase.stages.flatMap((stage) => stage.sessions);
  return phase;
}

export function normalizeTemplate(rawTemplate) {
  const template = cloneValue(rawTemplate || {});
  const metadata = normalizeMetadata(template.metadata || {});
  let grandOrder = 0;
  const phases = CANONICAL_PHASE_ORDER.map((phaseKey, phaseOrder) => {
    const rawPhase = (Array.isArray(template.phases) ? template.phases : []).find((candidate) => candidate?.key === phaseKey)
      || (Array.isArray(template.phases) ? template.phases[phaseOrder] : null)
      || { key: phaseKey };
    const phase = normalizePhase(rawPhase, phaseOrder, grandOrder);
    grandOrder += phase.sessions.length;
    return phase;
  });

  const phaseMap = Object.fromEntries(phases.map((phase) => [phase.key, phase]));
  const stages = phases.flatMap((phase) => phase.stages.map((stage) => ({ ...stage, phaseKey: phase.key, phaseLabel: phase.label })));
  const stageMap = Object.fromEntries(stages.map((stage) => [stage.key, stage]));
  const sessions = phases.flatMap((phase) => phase.sessions);
  const sessionMap = Object.fromEntries(sessions.map((session) => [session.key, session]));

  return {
    key: asTrimmedString(template.key),
    label: asTrimmedString(template.label),
    metadata,
    phases,
    phaseKeys: phases.map((phase) => phase.key),
    phaseMap,
    stages,
    stageMap,
    sessions,
    sessionMap,
  };
}

export function normalizeTemplateLibrary(rawTemplates = []) {
  const templates = (Array.isArray(rawTemplates) ? rawTemplates : []).map((template) => normalizeTemplate(template));
  const byKey = Object.fromEntries(templates.map((template) => [template.key, template]));
  return {
    templates,
    byKey,
  };
}

export function createBlankTemplate({
  key = "custom",
  label = "Custom",
  metadata = {},
} = {}) {
  return {
    key,
    label,
    metadata,
    phases: CANONICAL_PHASE_ORDER.map((phaseKey) => ({
      key: phaseKey,
      label: DEFAULT_PHASE_DEFINITIONS[phaseKey].label,
      owner: DEFAULT_PHASE_DEFINITIONS[phaseKey].owner,
      calendarSource: DEFAULT_PHASE_DEFINITIONS[phaseKey].calendarSource,
      durationWeeks: { ...DEFAULT_PHASE_DEFINITIONS[phaseKey].durationWeeks },
      stages: [],
    })),
  };
}

function formatScalar(value) {
  return JSON.stringify(value);
}

function formatObject(value, indentLevel) {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  if (!entries.length) return "{}";
  const indent = "  ".repeat(indentLevel);
  const childIndent = "  ".repeat(indentLevel + 1);
  return `{\n${entries
    .map(([key, entry]) => `${childIndent}${key}: ${formatValue(entry, indentLevel + 1)}`)
    .join(",\n")}\n${indent}}`;
}

function formatArray(value, indentLevel) {
  if (!value.length) return "[]";
  const indent = "  ".repeat(indentLevel);
  const childIndent = "  ".repeat(indentLevel + 1);
  return `[\n${value.map((entry) => `${childIndent}${formatValue(entry, indentLevel + 1)}`).join(",\n")}\n${indent}]`;
}

function formatValue(value, indentLevel = 0) {
  if (Array.isArray(value)) return formatArray(value, indentLevel);
  if (value && typeof value === "object") return formatObject(value, indentLevel);
  return formatScalar(value);
}

const SESSION_TEMPLATES_MODULE_FOOTER = `

const BUILT_IN_TEMPLATE_LIBRARY = normalizeTemplateLibrary(BUILT_IN_TEMPLATES);

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function getBuiltInTemplates() {
  return cloneValue(BUILT_IN_TEMPLATES);
}

export function getTemplateLibrary() {
  return cloneValue(BUILT_IN_TEMPLATE_LIBRARY);
}

export function getRawTemplateDefinition(templateKey) {
  return cloneValue(BUILT_IN_TEMPLATES.find((template) => template.key === templateKey) || BUILT_IN_TEMPLATES.find((template) => template.key === "custom") || BUILT_IN_TEMPLATES[0]);
}

export function getTemplateDefinition(templateKey, { templateSnapshot = null } = {}) {
  if (templateSnapshot) return normalizeTemplate(templateSnapshot);
  return cloneValue(BUILT_IN_TEMPLATE_LIBRARY.byKey[templateKey] || BUILT_IN_TEMPLATE_LIBRARY.byKey.custom || BUILT_IN_TEMPLATE_LIBRARY.templates[0]);
}

export function getTemplatePhases(templateKey, options = {}) {
  return cloneValue(getTemplateDefinition(templateKey, options).phaseMap || {});
}

export function getTemplateSessions(templateKey, options = {}) {
  return cloneValue(getTemplateDefinition(templateKey, options).sessions || []);
}

export function getTemplateOptions() {
  return BUILT_IN_TEMPLATE_LIBRARY.templates.map((template) => ({
    key: template.key,
    label: template.label,
  }));
}

export function getTemplateLabel(templateKey) {
  return getTemplateDefinition(templateKey)?.label || getTemplateDefinition("custom")?.label || "Custom";
}

export function getSessionBody(sessionKey, sessionName) {
  return (
    SESSION_BODIES[sessionKey] ||
    \`This session covers \${sessionName}.\n\nPlease come prepared with relevant examples, open questions, and any required system access.\`
  );
}

export function getTemplateReviewJSON(templates = BUILT_IN_TEMPLATES) {
  return JSON.stringify(templates, null, 2);
}

export function serializeTemplateLibrarySource(templates = BUILT_IN_TEMPLATES) {
  return buildSessionTemplatesModuleSource(templates);
}
`;

export function buildSessionTemplatesModuleSource(rawTemplates = []) {
  return `import { SESSION_BODIES } from "./session-bodies.js";
import {
  buildSessionTemplatesModuleSource,
  createBlankTemplate,
  normalizeTemplate,
  normalizeTemplateLibrary,
  validateTemplate,
} from "./template-schema.js";

export const BUILT_IN_TEMPLATES = ${formatValue(rawTemplates, 0)};${SESSION_TEMPLATES_MODULE_FOOTER}`;
}
