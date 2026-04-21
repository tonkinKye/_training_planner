import { getConflictSummary, getSessionConflicts, summarizeConflictKinds } from "./conflicts.js";
import { renderDayViewModal } from "./dayview.js";
import { getActiveProject, state } from "./state.js";
import {
  canCommitSession,
  canEditSession,
  deriveProjectReconciliationState,
  deriveProjectStatus,
  getActorDisplayName,
  getAllSessions,
  getContextPhaseKeys,
  getPhaseSessions,
  getPhaseStages,
  getPhaseSummary,
  getProjectCardStatus,
  getProjectCounts,
  getProjectDateRange,
  getProjectTemplateLabel,
  getTimelineSuggestion,
  getVisiblePhaseKeys,
  PHASE_META,
  PHASE_ORDER,
  PROJECT_TYPE_META,
  RECONCILIATION_STATE_META,
  pmCanEditImplementation,
  projectReadyToClose,
  STATUS_META,
} from "./projects.js";
import { getSmartAvailabilityState, readyForHandoff } from "./scheduler.js";
import { getTemplateEditorEntity, getTemplateEditorPreview, getTemplateEditorSelection } from "./template-editor.js";
import { esc, fmt12, fmtDur, getTimeOptionsHTML, mondayOf, parseDate, timeAgo, toDateStr } from "./utils.js";

const DURATION_OPTIONS = [30, 45, 60, 90, 120, 150, 180, 240, 480];
const STATUS_PRIORITY = { draft: 0, pm_scheduled: 1, handed_off_pending_is: 2, is_active: 3, closed: 4 };
const ARCHIVE_STATUSES = new Set(["closed"]);
const RENDER_SHELL_HTML = '<div id="tp-slot-topbar"></div><div id="tp-slot-main"></div><div id="tp-slot-overlays"></div><div class="tp-toast" id="toast"></div>';
const KANBAN_STATIC_LEADING_COLUMNS = [
  { key: "scheduling", label: "Scheduling", phase: "scheduling" },
  { key: "setup", label: "Setup", phase: "setup" },
];
const KANBAN_STATIC_TRAILING_COLUMNS = [
  { key: "hypercare", label: "Hypercare", phase: "hypercare" },
];
const TEMPLATE_TIMELINE_WEEK_WIDTH = 80;
const TEMPLATE_TIMELINE_MIN_PHASE_WIDTH = 320;
const TEMPLATE_TIMELINE_MIN_STAGE_WIDTH = 180;
const TEMPLATE_TIMELINE_STAGE_DROP_WIDTH = 18;
const TEMPLATE_TIMELINE_SESSION_CARD_HEIGHT = 88;

function fmtDate(value) {
  if (!value) return "Not set";
  return parseDate(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function fmtRange(start, end) {
  if (!start && !end) return "Not scheduled";
  if (!end || start === end) return fmtDate(start);
  return `${fmtDate(start)} - ${fmtDate(end)}`;
}

function fmtTimeLabel(timeValue) {
  return timeValue ? fmt12(timeValue) : "Time needed";
}

function smartPreferenceLabel(value) {
  if (value === "am") return "AM";
  if (value === "pm") return "PM";
  return "No Preference";
}

function getImplementationStageColumn(stage) {
  const key = String(stage?.key || "").trim();
  if (!key) return null;
  return {
    key,
    label: String(stage?.label || key).trim() || key,
    phase: "implementation",
    isMilestone: (stage.sessions || []).some((session) => session.lockedDate),
  };
}

export function getKanbanColumns(projects = state.projects) {
  const columns = [
    ...KANBAN_STATIC_LEADING_COLUMNS.map((column) => ({ ...column })),
  ];
  const seenImplementationStageKeys = new Set();

  for (const project of projects || []) {
    for (const stage of getPhaseStages(project, "implementation")) {
      const column = getImplementationStageColumn(stage);
      if (!column || seenImplementationStageKeys.has(column.key)) continue;
      seenImplementationStageKeys.add(column.key);
      columns.push(column);
    }
  }

  columns.push(...KANBAN_STATIC_TRAILING_COLUMNS.map((column) => ({ ...column })));
  return columns;
}

function fmtWeekRange(minWeeks, maxWeeks) {
  if (!minWeeks && !maxWeeks) return "";
  if (minWeeks && maxWeeks && minWeeks !== maxWeeks) {
    return `${minWeeks}-${maxWeeks} weeks`;
  }
  return `${minWeeks || maxWeeks} week${(minWeeks || maxWeeks) === 1 ? "" : "s"}`;
}

function fmtPhaseSpan(spanWeeks) {
  if (!spanWeeks) return "Not scheduled";
  return `${spanWeeks} week${spanWeeks === 1 ? "" : "s"}`;
}

function getScheduledCount(sessions) {
  return sessions.filter((session) => session.date && session.time).length;
}

function getDatedRange(sessions) {
  const dated = sessions
    .filter((session) => session.date)
    .map((session) => session.date)
    .sort((left, right) => left.localeCompare(right));

  return {
    start: dated[0] || "",
    end: dated[dated.length - 1] || "",
  };
}

function getDurationTotal(sessions) {
  return sessions.reduce((total, session) => total + (Number(session.duration) || 0), 0);
}

function getOwnerSummary(project, sessions, fallbackOwner = "") {
  const owners = [...new Set(sessions.map((session) => session.owner).filter(Boolean))];
  if (!owners.length && fallbackOwner) owners.push(fallbackOwner);
  return owners.map((owner) => getActorDisplayName(project, owner)).join(" + ");
}

function renderSummaryStat(label, value, emphasis = false) {
  return `<span class="tp-summary-stat${emphasis ? " is-emphasis" : ""}"><span class="tp-summary-stat-label">${esc(label)}</span><strong>${esc(value)}</strong></span>`;
}

function renderSummaryRange(start, end) {
  const label = start && end && start !== end ? "Range" : "Date";
  return renderSummaryStat(label, fmtRange(start, end), true);
}

function renderDisclosureButton(action, key, title, statsHTML, className = "", extrasHTML = "", expanded = false) {
  return `<button class="${className}" type="button" data-action="${action}" data-key="${key}" aria-expanded="${expanded ? "true" : "false"}">
    <div class="tp-panel-title-row">
      <div class="tp-panel-title-group"><span class="tp-panel-disclosure" aria-hidden="true"></span><span class="tp-panel-title">${esc(title)}</span></div>
      ${extrasHTML}
    </div>
    <div class="tp-panel-stats">${statsHTML}</div>
  </button>`;
}

export function getPhaseSectionKey(projectId, phaseKey, context = false) {
  return `${projectId}:${context ? "context" : "main"}:phase:${phaseKey}`;
}

export function getStageSectionKey(projectId, phaseKey, stageKey, context = false) {
  return `${getPhaseSectionKey(projectId, phaseKey, context)}:stage:${stageKey}`;
}

function getPhaseBadgeClass(phaseKey) {
  if (phaseKey === "setup") return "badge-setup";
  if (phaseKey === "implementation") return "badge-impl";
  if (phaseKey === "hypercare") return "badge-hypercare";
  return "badge-int";
}

function getColumnBadgeClass(column) {
  if (column.phase === "setup") return "badge-setup";
  if (column.phase === "implementation") return column.isMilestone ? "badge-golive" : "badge-training";
  if (column.phase === "hypercare") return "badge-hypercare";
  return "is-scheduling";
}

function getCalendarEventClass(phaseKey) {
  if (phaseKey === "setup") return "cal-event-teal";
  if (phaseKey === "implementation") return "cal-event-purple";
  if (phaseKey === "hypercare") return "cal-event-green";
  return "cal-event-gray";
}

function renderThemeToggle() {
  return `<button class="btn-default theme-toggle" data-action="toggleTheme" aria-label="Toggle theme" title="Toggle theme">
    <svg class="theme-toggle-sun" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4.5a1 1 0 0 1 1 1V7a1 1 0 1 1-2 0V5.5a1 1 0 0 1 1-1Zm0 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.5-4.5a1 1 0 0 1 0 2H18a1 1 0 1 1 0-2h1.5ZM7 12a1 1 0 0 1-1 1H4.5a1 1 0 1 1 0-2H6a1 1 0 0 1 1 1Zm10.303-4.803a1 1 0 0 1 1.414 1.414l-1.06 1.06a1 1 0 0 1-1.415-1.414l1.061-1.06ZM7.758 16.242a1 1 0 0 1 0 1.415l-1.06 1.06a1 1 0 1 1-1.415-1.414l1.061-1.061a1 1 0 0 1 1.414 0Zm10.96.001 1.061 1.06a1 1 0 1 1-1.414 1.415l-1.061-1.06a1 1 0 0 1 1.414-1.415ZM7.758 7.758 6.697 8.819A1 1 0 1 1 5.283 7.404l1.06-1.06a1 1 0 0 1 1.415 1.414ZM12 17a1 1 0 0 1 1 1v1.5a1 1 0 1 1-2 0V18a1 1 0 0 1 1-1Z"/>
    </svg>
    <svg class="theme-toggle-moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.56 3.46a1 1 0 0 1 1.17 1.29 7.5 7.5 0 0 0 8.95 9.55 1 1 0 0 1 1.05 1.61A10 10 0 1 1 12.4 2.4a1 1 0 0 1 1.16 1.06 7.47 7.47 0 0 0 1 0Z"/>
    </svg>
  </button>`;
}

function renderWorkingDaysChips(days, scope) {
  const selected = new Set(days || []);
  return `<div class="tp-working-days">
    ${[
      ["M", 1],
      ["T", 2],
      ["W", 3],
      ["T", 4],
      ["F", 5],
      ["S", 6],
      ["S", 0],
    ]
      .map(
        ([label, day]) =>
          `<button class="dp${selected.has(day) ? " is-active" : ""}" data-action="toggle${scope}WorkingDay" data-day="${day}">${label}</button>`
      )
      .join("")}
  </div>`;
}

function getTemplateOptionList() {
  return (state.templateLibrary || []).map((template) => ({
    key: template.key,
    label: template.label,
  }));
}

function getTemplateLabelForKey(templateKey) {
  return getTemplateOptionList().find((template) => template.key === templateKey)?.label
    || PROJECT_TYPE_META[templateKey]
    || templateKey
    || "Custom";
}

function renderTemplateOptions(selectedKey) {
  return getTemplateOptionList()
    .map(
      (template) =>
        `<option value="${template.key}"${selectedKey === template.key ? " selected" : ""}>${esc(template.label)}</option>`
    )
    .join("");
}

function renderStageOptions(source, phaseKey, selectedStageKey) {
  const stages = getPhaseStages(source, phaseKey);
  const hasSelected = stages.some((stage) => stage.key === selectedStageKey);
  const nextValue = selectedStageKey && hasSelected ? selectedStageKey : stages[0]?.key || "__new__";
  return `${stages
    .map((stage) => `<option value="${stage.key}"${nextValue === stage.key ? " selected" : ""}>${esc(stage.label)}</option>`)
    .join("")}<option value="__new__"${nextValue === "__new__" ? " selected" : ""}>Create New Stage</option>`;
}

function renderSessionRowsForStages(source, phaseKey, moveAction, removeAction, { editable = true } = {}) {
  return getPhaseStages(source, phaseKey)
    .map((stage) => {
      const sessions = stage.sessions || [];
      if (!sessions.length) return "";
      return `<div class="tp-settings-phase">
        <h4>${esc(stage.label)}</h4>
        ${sessions
          .map(
            (session) => `<div class="tp-settings-row"><div><strong>${esc(session.name)}</strong><small>${fmtDur(
              session.duration
            )} | ${session.owner === "is" ? "IS" : "PM"} | ${esc(session.type)}</small></div><div class="tp-quick-row">${session.lockedDate ? '<span class="tp-pill tp-pill-muted">System Managed</span>' : !editable ? '<span class="tp-pill tp-pill-muted">Read Only</span>' : `<button class="btn-default btn-sm" data-action="${moveAction}" data-id="${session.id}" data-dir="-1">Up</button><button class="btn-default btn-sm" data-action="${moveAction}" data-id="${session.id}" data-dir="1">Down</button><button class="btn-danger btn-sm" data-action="${removeAction}" data-id="${session.id}">Remove</button>`}</div></div>`
          )
          .join("")}
      </div>`;
    })
    .join("");
}

function renderSmartPreferenceToggle(selectedValue, actionName = "setSmartPreference") {
  return `<div class="tp-quick-row" role="group" aria-label="Smart Fill preference">
    ${[
      ["am", "AM"],
      ["none", "No Preference"],
      ["pm", "PM"],
    ]
      .map(
        ([value, label]) =>
          `<button class="hd${selectedValue === value ? " is-active" : ""}" data-action="${actionName}" data-value="${value}">${label}</button>`
      )
      .join("")}
  </div>`;
}

function topbar() {
  const project = getActiveProject();
  const templateDraft = state.ui.templateEditor.draft;
  const name = state.graphAccount?.name || state.graphAccount?.username || "Microsoft 365";
  const inWorkspace = state.ui.screen === "workspace" && project;
  const inTemplates = state.ui.screen === "templates";
  const projectStatus = inWorkspace ? deriveProjectStatus(project) : "";
  const canClose = inWorkspace && state.actor === "pm" && !["draft", "pm_scheduled", "closed"].includes(projectStatus);
  const breadcrumb = inWorkspace
    ? `Projects / <span class="tp-nav-crumb-current">${esc(project.clientName || "Untitled Project")}</span>`
    : inTemplates
      ? `Templates / <span class="tp-nav-crumb-current">${esc(templateDraft?.label || "Template Editor")}</span>`
      : '<span class="tp-nav-crumb-current">Projects</span>';
  const workspaceActions = !inWorkspace
    ? ""
    : `${state.actor === "pm" ? '<button class="btn-default" data-action="backToProjects">Projects</button>' : ""}${
        project.closedAt
          ? ""
          : `${conflictButton(project)}<button class="btn-amber" data-action="pushOwned">${state.actor === "is" ? "Commit to Calendar" : "Push All"}</button>${
              state.actor === "pm" && readyForHandoff(project) ? '<button class="btn-default" data-action="handoffToIs">Hand Off to IS</button>' : ""
            }${state.actor === "pm" ? '<button class="btn-ghost" data-action="generateClientPlan">Client Plan</button>' : ""}${
              canClose ? `<button class="btn-danger btn-sm" data-action="closeProject" data-id="${project.id}" data-name="${esc(project.clientName || "Untitled Project")}">Close Project</button>` : ""
            }`
      }`;
  const templateActions = !inTemplates
    ? ""
    : `<button class="btn-default" data-action="closeTemplateEditor">${state.ui.templateEditor.mode === "oneoff" ? "Back to Onboarding" : "Back to Projects"}</button>`;
  return `<header class="tp-nav">
    <div class="tp-nav-mark">TP</div>
    <div class="tp-nav-copy"><strong class="tp-nav-title">Training Planner</strong><span class="tp-nav-sub">${state.actor === "is" ? "IS View" : "PM View"}</span></div>
    <div class="tp-nav-sep"></div>
    <div class="tp-nav-crumb">${breadcrumb}</div>
    <div class="tp-nav-spacer"></div>
    <div class="tp-nav-actions">
      ${workspaceActions}
      ${templateActions}
      ${renderThemeToggle()}
      <button class="btn-ghost" data-action="toggleAuth">${esc(name)} | Sign Out</button>
    </div>
  </header>`;
}

function authScreen() {
  return `<main class="tp-screen tp-auth-screen">
    <section class="tp-auth-card">
      <div class="tp-auth-mark">TP</div>
      <div class="tp-auth-copy">
        <div class="tp-eyebrow">Training Planner</div>
        <h1>Login to proceed</h1>
        <p>Sign in with your work or school Microsoft 365 account to open projects and continue scheduling.</p>
      </div>
      <div class="tp-auth-actions">
        <button class="btn-amber btn-lg" data-action="toggleAuth">Sign In With Microsoft 365</button>
        <div class="tp-auth-note">Work / School M365 only</div>
      </div>
      ${state.authError ? `<div class="alert alert-danger">${esc(state.authError)}</div>` : ""}
    </section>
  </main>`;
}

function getProjectKanbanColumn(project) {
  const status = deriveProjectStatus(project);
  if (status === "draft" || status === "pm_scheduled") return "scheduling";
  const today = toDateStr(new Date());
  const allSessions = getAllSessions(project);
  const defaultImplementationStageKey = getPhaseStages(project, "implementation").find((stage) => stage?.key)?.key || "";
  const future = allSessions
    .filter((s) => s.date && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99"));
  const next = future[0];
  if (!next) {
    const undated = allSessions.filter((s) => !s.date);
    if (undated.length) {
      return undated[0].phase === "implementation"
        ? (undated[0].stageKey || defaultImplementationStageKey)
        : undated[0].phase;
    }
    return "hypercare";
  }
  return next.phase === "implementation" ? (next.stageKey || defaultImplementationStageKey) : next.phase;
}

function getNextAppointment(project) {
  const today = toDateStr(new Date());
  const next = getAllSessions(project)
    .filter((s) => s.date && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return next || null;
}

function getImplProgress(project) {
  const today = toDateStr(new Date());
  const sessions = getPhaseSessions(project, "implementation");
  if (!sessions.length) return { done: 0, total: 0, percent: 0 };
  const done = sessions.filter((s) => s.date && s.date < today).length;
  return { done, total: sessions.length, percent: Math.round((done / sessions.length) * 100) };
}

function getGoLiveCountdown(project) {
  if (!project.goLiveDate) return "";
  const today = toDateStr(new Date());
  if (project.goLiveDate <= today) return "Go-Live passed";
  const days = Math.ceil((parseDate(project.goLiveDate).getTime() - parseDate(today).getTime()) / 86400000);
  return days <= 7 ? `${days}d to Go-Live` : `${Math.ceil(days / 7)}w to Go-Live`;
}

function kanbanCard(project, archived) {
  const next = getNextAppointment(project);
  const progress = getImplProgress(project);
  const countdown = getGoLiveCountdown(project);
  const status = deriveProjectStatus(project);
  const readyToClose = state.actor === "pm" && projectReadyToClose(project);
  const canDelete = status === "draft" || status === "pm_scheduled";
  const nextLabel = next ? `${fmtDate(next.date).replace(/ \d{4}$/, "")} \u00B7 ${next.name}` : "Not scheduled";
  return `<button class="tp-project-card${archived ? " is-archived" : ""}" data-action="selectProject" data-id="${project.id}">
    <div class="tp-project-card-head"><strong>${esc(project.clientName || "Untitled")}</strong>${canDelete ? `<span class="tp-card-delete" data-action="deleteProject" data-id="${project.id}" data-name="${esc(project.clientName || "Untitled")}" title="Delete">&times;</span>` : ""}</div>
    <span class="tp-project-next">${esc(nextLabel)}</span>
    <div class="tp-project-progress"><div class="tp-project-progress-bar" style="width:${progress.percent}%"></div></div>
    <span class="tp-project-meta">${progress.total ? `${progress.percent}% impl` : ""}${progress.total && countdown ? " \u00B7 " : ""}${esc(countdown)}</span>
    ${readyToClose ? '<span class="tp-pill tp-pill-info">Ready to close</span>' : ""}
  </button>`;
}

function projectsScreen() {
  const search = (state.ui.projectSearch || "").toLowerCase().trim();
  const archivedCount = state.projects.filter((project) => ARCHIVE_STATUSES.has(deriveProjectStatus(project))).length;

  const visible = state.projects
    .filter((project) => {
      if (!state.ui.showArchived && ARCHIVE_STATUSES.has(deriveProjectStatus(project))) return false;
      if (search) {
        const haystack = `${project.clientName} ${project.isName} ${project.isEmail} ${project.pmName}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => (a.goLiveDate || "9999").localeCompare(b.goLiveDate || "9999"));
  const kanbanColumns = getKanbanColumns(visible);

  const isGroups = new Map();
  for (const project of visible) {
    const key = project.isName || project.isEmail || "Unassigned";
    if (!isGroups.has(key)) isGroups.set(key, []);
    isGroups.get(key).push(project);
  }

  const searchBar = `<div class="tp-projects-toolbar">
    <input type="text" class="tp-project-search" placeholder="Search projects..." value="${esc(state.ui.projectSearch)}" data-action="projectSearch">
    <label class="tp-toggle-label"><input type="checkbox" ${state.ui.showArchived ? "checked" : ""} data-action="toggleArchived"> Show archived (${archivedCount})</label>
  </div>`;

  let groupsHTML = "";
  for (const [isName, projects] of isGroups) {
    const columns = new Map();
    for (const col of kanbanColumns) columns.set(col.key, []);
    for (const project of projects) {
      const colKey = getProjectKanbanColumn(project);
      const target = columns.get(colKey);
      if (target) target.push(project);
    }

    const boardHTML = kanbanColumns.map((col) => {
      const cards = columns.get(col.key) || [];
      return `<div class="tp-kanban-column">
        <div class="tp-kanban-header ${getColumnBadgeClass(col)}"><span>${esc(col.label)}</span>${cards.length ? `<span class="tp-kanban-count">${cards.length}</span>` : ""}</div>
        ${cards.map((currentProject) => kanbanCard(currentProject, ARCHIVE_STATUSES.has(deriveProjectStatus(currentProject)))).join("")}
      </div>`;
    }).join("");

    groupsHTML += `<section class="tp-is-group">
      <header class="tp-is-group-header"><h2>${esc(isName)}</h2><span class="tp-muted">${projects.length} project${projects.length !== 1 ? "s" : ""}</span></header>
      <div class="tp-kanban-board">${boardHTML}</div>
    </section>`;
  }

  const emptyState = visible.length
    ? ""
    : state.projects.length
      ? `<section class="tp-empty-card"><h2>No matches</h2><p>No projects match "${esc(search)}"${!state.ui.showArchived && archivedCount ? ". Try showing archived projects." : ""}.</p></section>`
      : `<section class="tp-empty-card"><h2>No projects yet</h2><p>Create a project to seed the sentinel and open the scheduler.</p><button class="btn-amber" data-action="openOnboarding">Create Project</button></section>`;

  return `<main class="tp-screen">
    <section class="tp-screen-head">
      <div>
        <div class="tp-eyebrow">Sentinel-backed Project Index</div>
        <h1>Projects</h1>
      </div>
      <div class="tp-quick-row">
        <button class="btn-default" data-action="openTemplates">Templates</button>
        <button class="btn-amber" data-action="openOnboarding">New Project</button>
      </div>
    </section>
    ${state.sentinel.malformed ? `<section class="alert alert-danger alert-split"><div><strong>Could not load projects.</strong><div>${esc(state.sentinel.error || "Malformed sentinel payload.")}</div></div><button class="btn-danger" data-action="resetSentinel">Reset Sentinel</button></section>` : ""}
    ${state.projects.length ? searchBar : ""}
    ${groupsHTML}
    ${emptyState}
  </main>`;
}

function conflictButton(project) {
  const summary = getConflictSummary({ project, actor: state.actor, scope: "review", blockingOnly: true });
  return summary.sessions
    ? `<button class="btn-default" data-action="reviewConflicts">Review Conflicts (${summary.sessions})</button>`
    : '<button class="btn-default" data-action="checkConflicts">Check Conflicts</button>';
}

function renderConflictTags(conflicts) {
  const summary = summarizeConflictKinds(conflicts);
  return [
    summary.hasWindow ? `<span class="tp-pill tp-pill-warn">${summary.windowLabel}</span>` : "",
    summary.hasCalendar ? `<span class="tp-pill tp-pill-danger">${summary.calendarLabel}</span>` : "",
    summary.hasAvailability ? `<span class="tp-pill tp-pill-info">${summary.availabilityLabel}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
}

function getCalendarWarnings(project) {
  if (!project || state.calendarAvailability.projectId !== project.id) return [];
  return Array.isArray(state.calendarAvailability.warnings) ? state.calendarAvailability.warnings : [];
}

function renderCalendarWarnings(project) {
  const warnings = getCalendarWarnings(project);
  if (!warnings.length) return "";

  return warnings
    .map(
      (warning) => `<section class="alert alert-danger"><strong>${esc(warning.title || "Calendar Warning")}</strong><div>${esc(
        warning.message || "Calendar access is blocked."
      )}</div>${warning.detail ? `<small>${esc(warning.detail)}</small>` : ""}</section>`
    )
    .join("");
}

function projectHasResolvedPmImplementationState(project) {
  if (state.actor !== "pm" || !project?.handoff?.sentAt) return true;
  if (deriveProjectStatus(project) === "handed_off_pending_is") return false;
  if (deriveProjectReconciliationState(project) === "refresh_failed") return false;

  return getPhaseSessions(project, "implementation").some(
    (session) => session.graphEventId || session.lastKnownStart || session.lastKnownEnd || (session.date && session.time)
  );
}

function renderPmReconciliationPanel(project) {
  if (state.actor !== "pm" || !project?.handoff?.sentAt || project.closedAt) return "";

  const reconciliationState = deriveProjectReconciliationState(project);
  const lifecycleState = deriveProjectStatus(project);
  const lastAttempted = project.reconciliation?.lastAttemptedAt || "";
  const lastSuccessful = project.reconciliation?.lastSuccessfulAt || "";
  const lastFailed = project.reconciliation?.lastFailureAt || "";
  const lastFailureMessage = project.reconciliation?.lastFailureMessage || "";

  let title = RECONCILIATION_STATE_META[reconciliationState] || "Sync";
  let message = "";

  if (lifecycleState === "handed_off_pending_is") {
    title = "Awaiting IS";
    message = lastAttempted
      ? `Handoff sent. Waiting for IS acceptance. Last checked ${timeAgo(lastAttempted)}.`
      : "Handoff sent. Waiting for IS acceptance.";
  } else if (reconciliationState === "refresh_failed") {
    title = "Refresh Failed";
    message = `Authoritative IS state is unavailable.${lastFailed ? ` Refresh failed ${timeAgo(lastFailed)}.` : ""}${lastFailureMessage ? ` ${lastFailureMessage}` : ""}`;
  } else if (reconciliationState === "drift_detected") {
    message = `IS reported drift between the sentinel and the live calendar.${lastSuccessful ? ` Last confirmed ${timeAgo(lastSuccessful)}.` : ""}`;
  } else if (reconciliationState === "in_sync") {
    message = `Implementation state is in sync.${lastSuccessful ? ` Last reconciled ${timeAgo(lastSuccessful)}.` : ""}`;
  } else {
    message = lastAttempted
      ? `Implementation state last checked ${timeAgo(lastAttempted)}.`
      : "Implementation state has not been reconciled yet.";
  }

  return `<section class="tp-side-card">
    <div class="tp-side-head"><h3>Implementation Sync</h3><button class="btn-default btn-sm" data-action="refreshProjectState" data-id="${project.id}">Refresh</button></div>
    <div class="tp-side-note"><strong>${esc(title)}</strong><div>${esc(message)}</div></div>
  </section>`;
}

function renderPmImplementationPlaceholder(project) {
  const reconciliationState = deriveProjectReconciliationState(project);
  const lifecycleState = deriveProjectStatus(project);
  let message = "Authoritative implementation state is unavailable.";

  if (lifecycleState === "handed_off_pending_is") {
    message = "Handoff sent. Waiting for the IS to accept the project before implementation state is available.";
  } else if (reconciliationState === "refresh_failed") {
    message = "Refresh failed. The PM sentinel does not store a stale implementation snapshot; use Refresh to retry.";
  }

  return `<section class="tp-phase-section tp-phase-context is-open is-implementation">
    <div class="tp-phase-static-head">
      <div class="tp-phase-title">Implementation</div>
      <p class="tp-phase-meta">${esc(message)}</p>
    </div>
  </section>`;
}

function getAvailabilityMessage(project, availability) {
  const matchesProject = state.calendarAvailability.projectId === project.id;
  const sources = state.calendarAvailability.sources || {};
  const statuses = Object.values(sources).map((source) => source.status);
  const hasLoading = matchesProject && statuses.includes("loading");
  const pmReady = Boolean(availability.ownerStates?.pm?.ready);
  const isReady = Boolean(availability.ownerStates?.is?.ready);

  if (hasLoading) {
    return state.actor === "is"
      ? "Refreshing implementation calendar availability..."
      : "Refreshing PM and implementation calendar availability...";
  }
  if (availability.ready) {
    return state.actor === "is"
      ? "Implementation availability loaded"
      : "PM and implementation availability loaded";
  }
  if (state.actor === "pm" && pmReady && !isReady) {
    return "PM availability loaded; implementation timing is blocked until the IS calendar is available";
  }
  if (state.actor === "pm" && !pmReady && isReady) {
    return "Implementation availability loaded; setup and hypercare checks are blocked until the PM calendar is available";
  }
  return "No availability loaded; Smart Fill will assign dates only";
}

function renderProjectSummaryActions(project) {
  if (!project || project.closedAt) return "";
  const status = deriveProjectStatus(project);
  const showDelete = state.actor === "pm" && (status === "draft" || status === "pm_scheduled");
  return `<div class="tp-side-actions" role="group" aria-label="Project actions">
    <button class="btn-ghost btn-sm" data-action="openSettings">Project Settings</button>
    ${showDelete ? `<button class="btn-danger btn-sm" data-action="deleteProject" data-id="${project.id}" data-name="${esc(project.clientName || "Untitled Project")}">Delete</button>` : ""}
  </div>`;
}

function sidebar(project) {
  const range = getProjectDateRange(project);
  const availability = getSmartAvailabilityState(project, state.actor);
  const availabilityMessage = getAvailabilityMessage(project, availability);
  const readyToClose = state.actor === "pm" && projectReadyToClose(project);
  return `<aside class="tp-sidebar">
    ${renderProjectSummaryActions(project)}
    <section class="tp-side-card">
      <div class="tp-card-top">
        <span class="tp-pill">${esc(getProjectTemplateLabel(project))}</span>
        <span class="tp-pill tp-pill-muted">${esc(getProjectCardStatus(project))}</span>
      </div>
      <h2>${esc(project.clientName)}</h2>
      <dl class="tp-meta-list">
        <div><dt>PM</dt><dd>${esc(project.pmName || project.pmEmail || "Not set")}</dd></div>
        <div><dt>IS</dt><dd>${esc(project.isName || project.isEmail || "Not set")}</dd></div>
        <div><dt>Kick-Off</dt><dd>${esc(fmtDate(project.projectStart))}</dd></div>
        <div><dt>Implementation</dt><dd>${esc(fmtRange(project.implementationStart, project.goLiveDate ? toDateStr(new Date(parseDate(project.goLiveDate).getTime() - 86400000)) : ""))}</dd></div>
        <div><dt>Go-Live</dt><dd>${esc(fmtDate(project.goLiveDate))}</dd></div>
        <div><dt>Range</dt><dd>${esc(fmtRange(range.start, range.end))}</dd></div>
        <div><dt>Location</dt><dd>${esc(project.location || "TBC")}</dd></div>
      </dl>
      ${
        state.ui.lastHandoff.url
          ? `<div class="tp-side-note"><strong>Latest handoff</strong><div>${state.ui.lastHandoff.length} chars</div><button class="btn-default btn-sm" data-action="copyHandoffLink">Copy Link</button></div>`
          : ""
      }
      ${
        readyToClose
          ? '<div class="alert alert-info"><strong>Ready to close</strong><div>All sessions are in the past and the latest reconciliation is in sync.</div></div>'
          : ""
      }
    </section>
    ${renderPmReconciliationPanel(project)}
    ${renderCalendarWarnings(project)}
    <section class="tp-side-card">
      <div class="tp-side-head"><h3>Smart Fill</h3><button class="btn-ghost btn-sm" data-action="toggleSmart">${state.ui.smartOpen ? "Hide" : "Show"}</button></div>
      ${
        state.ui.smartOpen
          ? `<label class="tp-field"><span>Kick-Off Date</span><input class="tp-mono" type="date" value="${state.ui.smartStart}" data-action="setSmartStart"><small class="tp-muted">The date of the Kick-Off Call. Internal prep sessions will be placed before this date.</small>${state.ui.smartStart && state.ui.smartStart < toDateStr(new Date()) ? '<small class="tp-warning-copy">This date is in the past. Smart Fill will shift sessions forward to today.</small>' : ""}</label>
             <div class="tp-field"><span>Days</span><div class="tp-working-days">
               ${[
                 ["M", 1],
                 ["T", 2],
                 ["W", 3],
                 ["T", 4],
                 ["F", 5],
                 ["S", 6],
                 ["S", 0],
               ]
                 .map(
                   ([label, day]) =>
                     `<button class="dp${state.ui.activeDays.has(day) ? " is-active" : ""}" data-action="toggleActiveDay" data-day="${day}">${label}</button>`
                 )
                 .join("")}
             </div></div>
             <div class="tp-field"><span>Preferred half-day</span>${renderSmartPreferenceToggle(state.ui.smartPreference)}</div>
             <div class="tp-quick-row">
               <button class="btn-default btn-sm" data-action="setDayPreset" data-days="1,2,3,4,5">Weekdays</button>
               <button class="btn-default btn-sm" data-action="setDayPreset" data-days="1,3,5">M/W/F</button>
               <button class="btn-default btn-sm" data-action="setDayPreset" data-days="2,4">T/Th</button>
             </div>
             <div class="tp-quick-row">
               <button class="btn-default" data-action="refreshSmartAvailability">Refresh Availability</button>
               <button class="btn-amber" data-action="applySmartFill">Apply Smart Fill</button>
               <button class="btn-danger btn-sm" data-action="clearSmartFill">Clear Schedule</button>
             </div>
             <p class="sf-status${availability.ready ? " is-ready" : ""}">${availabilityMessage}</p>`
          : '<p class="tp-muted">Phase-aware Smart Fill respects setup, implementation, and hypercare windows.</p>'
      }
    </section>
  </aside>`;
}

function sessionBadges(project, session, context) {
  const scope = editableConflictScope(project, session, context);
  const conflicts = getSessionConflicts(session.id, { project, actor: state.actor, scope });
  return [
    `<span class="badge ${session.owner === "is" ? "badge-is" : "badge-pm"}">${session.owner === "is" ? "IS" : "PM"}</span>`,
    `<span class="badge ${getPhaseBadgeClass(session.phase)}">${esc(PHASE_META[session.phase].label)}</span>`,
    `<span class="badge ${session.type === "internal" ? "badge-int" : "badge-ext"}">${session.type === "internal" ? "Internal" : "External"}</span>`,
    context ? '<span class="tp-pill tp-pill-muted">Context</span>' : "",
    renderConflictTags(conflicts),
  ]
    .filter(Boolean)
    .join("");
}

function editableConflictScope(project, session, context) {
  if (context || !canEditSession(project, session, state.actor)) return "editable";
  return "editable";
}

function sessionRow(project, session, context = false, isNextUp = false) {
  const today = toDateStr(new Date());
  const past = session.date && session.date < today ? " sc-past" : "";
  const editable = canEditSession(project, session, state.actor) && !context;
  const durationDisabled = editable && state.actor === "pm" ? "" : "disabled";
  const dateDisabled = editable && !session.lockedDate ? "" : "disabled";
  const timeDisabled = editable && !session.lockedTime ? "" : "disabled";
  return `<article class="sc${session.phase === "implementation" ? " sc-impl" : ""}${context ? " sc-context" : ""}${past}${isNextUp ? " sc-active" : ""}">
    <div class="sc-header">
      <div class="sc-title"><div class="sc-name">${esc(session.name)}</div><div class="sc-badges">${sessionBadges(project, session, context)}${isNextUp ? '<span class="badge badge-next">Next</span>' : ""}</div></div>
      <div class="sc-actions">
        <button class="btn-default btn-sm" data-action="openDayView" data-date="${session.date || project.implementationStart || project.goLiveDate || toDateStr(new Date())}">Week</button>
        ${editable && session.date && !session.lockedDate ? `<button class="btn-default btn-sm" data-action="unscheduleSession" data-id="${session.id}">Unschedule</button>` : ""}
        ${canCommitSession(session, state.actor) && session.date && session.time ? `<button class="btn-default btn-sm" data-action="pushSession" data-id="${session.id}">${session.graphActioned ? "Update" : "Push"}</button>` : ""}
        ${session.type === "external" && session.date && session.time ? `<button class="btn-default btn-sm" data-action="openOutlook" data-id="${session.id}">Outlook</button>` : ""}
        ${state.actor === "pm" && editable ? `<button class="btn-default btn-sm" data-action="moveSession" data-id="${session.id}" data-dir="-1">Up</button><button class="btn-default btn-sm" data-action="moveSession" data-id="${session.id}" data-dir="1">Down</button><button class="btn-danger btn-sm" data-action="removeSession" data-id="${session.id}">Remove</button>` : ""}
      </div>
    </div>
    <div class="sc-fields">
      <label class="tp-field tp-field-compact"><span>Date</span><input class="tp-mono" type="date" value="${session.date || ""}" ${dateDisabled} data-action="setSessionDate" data-id="${session.id}"></label>
      <label class="tp-field tp-field-compact"><span>Time</span><select class="tp-mono" ${timeDisabled} data-action="setSessionTime" data-id="${session.id}">${getTimeOptionsHTML(session.time || "")}</select></label>
      <label class="tp-field tp-field-compact"><span>Duration</span><select class="tp-mono" ${durationDisabled} data-action="setSessionDuration" data-id="${session.id}">${DURATION_OPTIONS.map((m) => `<option value="${m}"${m === session.duration ? " selected" : ""}>${fmtDur(m)}</option>`).join("")}</select></label>
    </div>
  </article>`;
}

function renderStageSection(project, phaseKey, stage, context, nextUpId) {
  const stageKey = getStageSectionKey(project.id, phaseKey, stage.key, context);
  const expanded = state.ui.expandedStageSections?.has(stageKey);
  const sessions = stage.sessions || [];
  const scheduled = getScheduledCount(sessions);
  const range = getDatedRange(sessions);
  const stats = [
    renderSummaryStat("Owner", getOwnerSummary(project, sessions, PHASE_META[phaseKey].owner)),
    renderSummaryStat("Duration", fmtDur(getDurationTotal(sessions))),
    renderSummaryStat("Scheduled", `${scheduled} / ${sessions.length}`),
    renderSummaryRange(range.start, range.end),
  ].join("");

  return `<section class="tp-stage-group${expanded ? " is-open" : ""}">
    ${renderDisclosureButton("toggleStageSection", stageKey, stage.label, stats, "tp-stage-toggle", "", expanded)}
    ${
      expanded
        ? `<div class="tp-stage-body">${sessions
            .map((currentSession) => sessionRow(project, currentSession, context, !context && currentSession.id === nextUpId))
            .join("")}</div>`
        : ""
    }
  </section>`;
}

function phaseSection(project, phaseKey, context = false, nextUpId = "") {
  const stages = getPhaseStages(project, phaseKey).filter((stage) => (stage.sessions || []).length);
  if (!stages.length) return "";
  const summary = getPhaseSummary(project, phaseKey);
  const key = getPhaseSectionKey(project.id, phaseKey, context);
  const expanded = state.ui.expandedPhaseSections?.has(key);
  const sessions = stages.flatMap((stage) => stage.sessions || []);
  const stats = [
    renderSummaryStat("Owner", getOwnerSummary(project, sessions, PHASE_META[phaseKey].owner)),
    renderSummaryStat("Duration", fmtDur(getDurationTotal(sessions))),
    renderSummaryStat("Scheduled", `${summary.scheduled} / ${summary.total}`),
    renderSummaryRange(summary.rangeStart, summary.rangeEnd),
  ].join("");
  const extras = [
    summary.spanWeeks ? `<span class="tp-pill tp-pill-muted">${esc(fmtPhaseSpan(summary.spanWeeks))}</span>` : "",
    summary.exceedsSuggestedMax ? '<span class="tp-pill tp-pill-warn">Over suggested</span>' : "",
  ]
    .filter(Boolean)
    .join("");

  return `<section class="tp-phase-section${context ? " tp-phase-context" : ""}${expanded ? " is-open" : ""}${phaseKey === "implementation" ? " is-implementation" : ""}">
    ${renderDisclosureButton("togglePhaseSection", key, PHASE_META[phaseKey].label, stats, "tp-phase-toggle", extras, expanded)}
    ${
      expanded
        ? `<div class="tp-phase-body"><div class="tp-phase-list">${stages
            .map((stage) => renderStageSection(project, phaseKey, stage, context, nextUpId))
            .join("")}</div></div>`
        : ""
    }
  </section>`;
}

function sessionPanel(project) {
  const today = toDateStr(new Date());
  const allProjectSessions = getAllSessions(project);
  const nextUpSession = allProjectSessions
    .filter((s) => s.date && s.date >= today && s.time)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""))[0] || null;
  const nextUpId = nextUpSession?.id || "";
  const visible = getVisiblePhaseKeys(state.actor, project);
  const context = getContextPhaseKeys(state.actor, project);
  return `<section class="tp-main">
    <div class="tp-main-header"><div class="tp-main-title">${esc(project.clientName)}</div><div class="tp-main-sub">${esc(getProjectTemplateLabel(project))} | ${esc(getProjectCardStatus(project))}</div></div>
    <div class="tp-main-content">
      ${visible.map((phaseKey) => {
        if (state.actor === "pm" && phaseKey === "implementation" && !projectHasResolvedPmImplementationState(project)) {
          return renderPmImplementationPlaceholder(project);
        }
        return phaseSection(project, phaseKey, false, nextUpId);
      }).join("")}
      ${
        state.actor === "is"
          ? `<section class="tp-phase-section tp-phase-context is-open"><div class="tp-phase-static-head"><div class="tp-phase-title">Read-only Context</div><p class="tp-phase-meta">Setup and Hypercare remain visible for handoff context.</p></div><div class="tp-phase-body"><div class="tp-phase-list">${context.map((phaseKey) => phaseSection(project, phaseKey, true)).join("")}</div></div></section>`
          : ""
      }
    </div>
  </section>`;
}

function calendarPanel(project) {
  if (!state.calStart) {
    const range = getProjectDateRange(project);
    state.calStart = mondayOf(parseDate(range.start || toDateStr(new Date())));
  }
  const cols = 7;
  const weeks = 6;
  const range = getProjectDateRange(project);
  const unscheduled = getAllSessions(project).filter((session) => canEditSession(project, session, state.actor) && !session.date);
  const conflictSummary = getConflictSummary({ project, actor: state.actor, scope: "review", blockingOnly: true });
  const cells = [];
  for (let i = 0; i < cols * weeks; i += 1) {
    const date = new Date(state.calStart);
    date.setDate(date.getDate() + i);
    const dateString = toDateStr(date);
    const sessions = getAllSessions(project).filter((session) => session.date === dateString);
    const dayConflictKinds = sessions.reduce(
      (acc, session) => {
        const summary = summarizeConflictKinds(getSessionConflicts(session.id, { project, actor: state.actor, scope: "editable" }));
        return {
          hasWindow: acc.hasWindow || summary.hasWindow,
          hasCalendar: acc.hasCalendar || summary.hasCalendar,
          hasAvailability: acc.hasAvailability || summary.hasAvailability,
        };
      },
      { hasWindow: false, hasCalendar: false, hasAvailability: false }
    );
    cells.push({
      date,
      dateString,
      sessions,
      today: dateString === toDateStr(new Date()),
      inRange: Boolean(range.start && range.end && dateString >= range.start && dateString <= range.end),
      hasWindowConflict: dayConflictKinds.hasWindow,
      hasCalendarConflict: dayConflictKinds.hasCalendar,
      hasAvailabilityConflict: dayConflictKinds.hasAvailability,
    });
  }
  return `<section class="tp-cal-panel">
    <div class="tp-panel-head"><div><h2>Calendar</h2><p>${conflictSummary.sessions ? `${conflictSummary.sessions} sessions need review${conflictSummary.label ? ` | ${esc(conflictSummary.label)}` : ""}` : "Drop sessions onto a day or open week view."}</p></div></div>
    <div class="tp-unscheduled"><strong>Unscheduled</strong><div class="tp-unscheduled-list">${unscheduled.length ? unscheduled.map((s) => `<div class="cal-event ${getCalendarEventClass(s.phase)}" draggable="true" data-drag="session" data-id="${s.id}">${esc(s.name)} <small>${fmtDur(s.duration)}</small></div>`).join("") : '<span class="tp-muted">All editable sessions are scheduled.</span>'}</div></div>
    <div class="tp-calendar-nav"><button class="btn-default btn-sm" data-action="calShift" data-dir="-1">Prev</button><button class="btn-default btn-sm" data-action="calToday">Today</button><button class="btn-default btn-sm" data-action="calShift" data-dir="1">Next</button></div>
    <div class="tp-calendar-scroll"><div class="tp-calendar-grid" style="grid-template-columns:32px repeat(${cols},1fr);"><div class="tp-week-spacer"></div>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].slice(0, cols).map((d) => `<div class="tp-cal-head">${d}</div>`).join("")}${Array.from({ length: weeks }).map((_, week) => `<div class="tp-week-label">W${week + 1}</div>${cells.slice(week * cols, week * cols + cols).map((cell) => `<div class="tp-cal-day${cell.inRange ? " cal-day-range" : ""}${cell.today ? " cal-day-today" : ""}${cell.hasCalendarConflict || cell.hasWindowConflict || cell.hasAvailabilityConflict ? " cal-day-conflict" : ""}${cell.sessions.length ? " cal-day-has-session" : ""}" data-drop data-date="${cell.dateString}"><button class="tp-cal-date" data-action="openDayView" data-date="${cell.dateString}">${cell.date.getDate()}</button><div class="tp-cal-events">${cell.sessions.map((s) => `<div class="cal-event ${getCalendarEventClass(s.phase)}${canEditSession(project, s, state.actor) ? "" : " is-context"}${!s.time && s.availabilityConflict === true ? " is-needs-time" : ""}${s.date && s.date < toDateStr(new Date()) ? " is-past" : ""}" ${canEditSession(project, s, state.actor) && !s.lockedDate ? `draggable="true" data-drag="session" data-id="${s.id}"` : ""}><span>${esc(s.name)}</span><small>${esc(fmtTimeLabel(s.time))}</small></div>`).join("")}</div></div>`).join("")}`).join("")}</div></div>
  </section>`;
}

function workspace(project) {
  const closedBanner = project.closedAt
    ? `<div class="alert alert-danger alert-split"><strong>Project Closed</strong><span>by ${esc(project.closedBy || "PM")} on ${esc(fmtDate(project.closedAt))}</span>${state.actor === "is" ? ' <button class="btn-default btn-sm" data-action="cleanUpCalendar">Clean Up Calendar</button>' : ""}</div>`
    : "";
  return `<main class="tp-screen tp-workspace-screen">
    ${closedBanner}
    <div class="tp-workspace">${sidebar(project)}${sessionPanel(project)}${calendarPanel(project)}</div>
  </main>`;
}

function onboardingStep() {
  const d = state.ui.onboarding.draft;
  if (!d) return "";
  const step = state.ui.onboarding.step;
  if (step === 0) return `<label class="tp-field"><span>Client Name</span><input type="text" value="${esc(d.clientName)}" data-bind="onboarding.clientName"></label><label class="tp-field"><span>Project Type</span><select data-bind="onboarding.projectType">${renderTemplateOptions(d.templateOriginKey || d.projectType)}</select><small class="tp-muted">Reusable templates are editable in the Templates screen.</small></label><div class="tp-field"><span>One-Off</span><button class="btn-default" data-action="openOnboardingTemplateEditor">Customize This Project Template</button></div>`;
  if (step === 1) {
    const sharedCalendarOptions = state.ui.sharedCalendarOptions || [];
    const sharedCalendarStatus = state.ui.sharedCalendarStatus || "idle";
    const sharedCalendarHint = sharedCalendarStatus === "loading"
      ? '<small class="tp-muted">Loading shared calendars from Outlook...</small>'
      : sharedCalendarStatus === "error"
        ? `<small class="tp-warning-copy">${esc(state.ui.sharedCalendarError || "Could not load shared calendars. Enter the IS details manually.")}</small>`
        : sharedCalendarStatus === "ready" && !sharedCalendarOptions.length
          ? '<small class="tp-muted">No shared calendars were found for this PM. Enter the IS details manually.</small>'
          : '<small class="tp-muted">Choose an existing shared Outlook calendar to prefill the IS details, or enter them manually below.</small>';

    return `<label class="tp-field"><span>PM Name</span><input type="text" value="${esc(d.pmName)}" data-bind="onboarding.pmName"></label><label class="tp-field"><span>PM Email</span><input type="email" value="${esc(d.pmEmail)}" data-bind="onboarding.pmEmail"></label><label class="tp-field"><span>IS Shared Calendar</span><select data-action="selectSharedCalendar"><option value="">Choose shared calendar</option>${sharedCalendarOptions.map((calendar) => `<option value="${esc(calendar.id)}"${calendar.id === state.ui.selectedSharedCalendarId ? " selected" : ""}>${esc(calendar.label)}</option>`).join("")}</select>${sharedCalendarHint}</label><div class="tp-quick-row"><button class="btn-default btn-sm" data-action="loadSharedCalendars"${sharedCalendarStatus === "loading" ? " disabled" : ""}>Refresh Shared Calendars</button><span class="tp-muted">Uses calendars already shared with the PM.</span></div><label class="tp-field"><span>IS Name</span><input type="text" value="${esc(d.isName)}" data-bind="onboarding.isName"></label><label class="tp-field"><span>IS Email</span><input type="email" value="${esc(d.isEmail)}" data-bind="onboarding.isEmail"></label>`;
  }
  if (step === 2) {
    const tl = getTimelineSuggestion(d);
    const fmtWk = (min, max) => min && max && min !== max ? `${min}\u2013${max} weeks` : `${min || max || "?"} week${(min || max) === 1 ? "" : "s"}`;
    const goLiveEarlierThanRec = d.goLiveDate && tl.earliestGoLive && d.goLiveDate < tl.earliestGoLive;
    const kickOffLabel = d.projectStart ? fmtDate(d.projectStart) : "";
    const contextLine = kickOffLabel && tl.setupMin && tl.implMin ? `Based on ${esc(kickOffLabel)} kick-off \u00B7 ${tl.setupMin} wk setup \u00B7 ${Math.max(tl.implMin, tl.implFloor)} wk implementation` : "";
    return `<div class="tp-settings-grid">
      <label class="tp-field"><span>Kick-Off Date</span><input class="tp-mono" type="date" value="${d.projectStart}" data-bind="onboarding.projectStart"></label>
      <label class="tp-field"><span>Go-Live Date</span><input class="tp-mono" type="date" value="${d.goLiveDate}" data-bind="onboarding.goLiveDate">${tl.earliestGoLive ? `<small class="tp-muted">Earliest recommended: ${esc(fmtDate(tl.earliestGoLive))}</small>` : ""}${goLiveEarlierThanRec ? `<small class="tp-warning-copy">This is earlier than the recommended minimum. The timeline may be too tight for this template.</small>` : ""}</label>
      <label class="tp-field"><span>Hypercare</span><select data-bind="onboarding.hypercareDuration"><option value="1 week"${d.hypercareDuration === "1 week" ? " selected" : ""}>1 week</option><option value="2 weeks"${d.hypercareDuration === "2 weeks" ? " selected" : ""}>2 weeks</option></select></label>
      <label class="tp-field"><span>Smart Fill Default</span><select data-bind="onboarding.smartFillPreference"><option value="am"${d.smartFillPreference === "am" ? " selected" : ""}>AM</option><option value="none"${d.smartFillPreference === "none" ? " selected" : ""}>No Preference</option><option value="pm"${d.smartFillPreference === "pm" ? " selected" : ""}>PM</option></select></label>
      <div class="tp-field tp-field-full"><span>Working Days</span>${renderWorkingDaysChips(d.workingDays, "Onboarding")}</div>
      <div class="tp-summary-card tp-field-full">
        <div class="tp-timeline-breakdown">
          <div class="tp-timeline-row"><span>Setup</span><strong>${tl.setupMin != null ? esc(fmtWk(tl.setupMin, tl.setupMax)) : "N/A"}</strong></div>
          <div class="tp-timeline-row"><span>Implementation</span><strong>${tl.implMin != null ? esc(fmtWk(tl.implMin, tl.implMax)) : "N/A"}</strong></div>
          <div class="tp-timeline-row"><span>Hypercare</span><strong>${tl.hcMin != null ? esc(fmtWk(tl.hcMin, tl.hcMax)) : "N/A"}</strong></div>
          <div class="tp-divider"></div>
          <div class="tp-timeline-row tp-timeline-total"><span>Total from Kick-Off</span><strong>${tl.totalMin ? esc(fmtWk(tl.totalMin, tl.totalMax)) : "N/A"}</strong></div>
          ${tl.earliestGoLive ? `<div class="tp-timeline-row"><span>Earliest Go-Live</span><strong>${esc(fmtDate(tl.earliestGoLive))}</strong></div>` : ""}
          ${tl.earliestWrapUp ? `<div class="tp-timeline-row"><span>Earliest wrap-up</span><strong>${esc(fmtDate(tl.earliestWrapUp))}</strong></div>` : ""}
        </div>
        ${tl.implFloorExceedsMin ? `<p class="tp-warning-copy">Minimum ${tl.implFloor} implementation weeks required at 3 sessions/week — exceeds the template suggestion of ${tl.implMin}.</p>` : ""}
        ${contextLine ? `<p class="tp-muted">${contextLine}</p>` : ""}
      </div>
      <p class="tp-muted tp-field-full">Internal sessions (Sales Handover, Installation) will be placed before the Kick-Off Date where possible.</p>
    </div>`;
  }
  if (step === 3) return `<label class="tp-field tp-field-full"><span>Invitees</span><textarea rows="5" data-bind="onboarding.invitees">${esc(Array.isArray(d.invitees) ? d.invitees.join(", ") : d.invitees)}</textarea><small class="tp-muted">Use commas or new lines to separate attendee email addresses.</small></label>`;
  if (step === 4) return `<label class="tp-field"><span>Location</span><input type="text" value="${esc(d.location)}" data-bind="onboarding.location"><small class="tp-muted">Enter a room name or Teams URL.</small></label>`;
  if (step === 5) return `<div class="tp-settings-list">${PHASE_ORDER.map((phaseKey) => renderSessionRowsForStages(d, phaseKey, "moveOnboardingSession", "removeOnboardingSession")).join("")}</div><div class="tp-builder-grid"><label class="tp-field tp-field-compact"><span>Name</span><input type="text" value="${esc(d.customSession.name)}" data-bind="onboarding.customSession.name"></label><label class="tp-field tp-field-compact"><span>Duration</span><input class="tp-mono" type="number" min="15" step="15" value="${d.customSession.duration}" data-bind="onboarding.customSession.duration"></label><label class="tp-field tp-field-compact"><span>Phase</span><select data-bind="onboarding.customSession.phase">${PHASE_ORDER.map((p) => `<option value="${p}"${d.customSession.phase === p ? " selected" : ""}>${esc(PHASE_META[p].label)}</option>`).join("")}</select></label><label class="tp-field tp-field-compact"><span>Stage</span><select data-bind="onboarding.customSession.stageKey">${renderStageOptions(d, d.customSession.phase, d.customSession.stageKey)}</select></label>${d.customSession.stageKey === "__new__" || !getPhaseStages(d, d.customSession.phase).length ? `<label class="tp-field tp-field-compact"><span>New Stage Label</span><input type="text" value="${esc(d.customSession.newStageLabel)}" data-bind="onboarding.customSession.newStageLabel"></label>` : ""}<label class="tp-field tp-field-compact"><span>Owner</span><select data-bind="onboarding.customSession.owner"><option value="pm"${d.customSession.owner === "pm" ? " selected" : ""}>PM</option><option value="is"${d.customSession.owner === "is" ? " selected" : ""}>IS</option></select></label><label class="tp-field tp-field-compact"><span>Type</span><select data-bind="onboarding.customSession.type"><option value="external"${d.customSession.type === "external" ? " selected" : ""}>External</option><option value="internal"${d.customSession.type === "internal" ? " selected" : ""}>Internal</option></select></label><button class="btn-amber" data-action="addOnboardingSession">Add Session</button></div>`;
  return `<div class="tp-summary-card"><h4>${esc(d.clientName || "New Project")}</h4><p>${esc(d.templateLabel || getTemplateLabelForKey(d.templateOriginKey || d.projectType))} | ${esc(d.pmName || d.pmEmail)} -> ${esc(d.isName || d.isEmail)}</p><p>Implementation window: ${esc(fmtRange(d.implementationStart, d.goLiveDate))}</p><p>Smart Fill default: ${esc(smartPreferenceLabel(d.smartFillPreference))}</p><p>${getAllSessions(d).length} sessions will be written to the sentinel.</p></div><details class="tp-template-review"><summary>Template JSON</summary><pre>${esc(state.ui.onboarding.templateReviewJSON)}</pre></details>`;
}

function onboardingModal() {
  if (!state.ui.onboarding.open) return "";
  const labels = ["Client", "Team", "Timeline", "Invitees", "Location", "Sessions", "Confirm"];
  return `<div class="tp-modal-overlay is-open"><div class="tp-modal tp-modal-wide"><div class="tp-modal-head"><div><h3>New Project</h3><p>${labels[Math.min(state.ui.onboarding.step, labels.length - 1)]}</p></div><button class="btn-default btn-sm" data-action="closeOnboarding">Close</button></div><div class="tp-stepper">${labels.map((l, i) => `<span class="tp-step${i === state.ui.onboarding.step ? " is-active" : ""}${i < state.ui.onboarding.step ? " is-done" : ""}">${esc(l)}</span>`).join("")}</div><div class="tp-modal-body">${onboardingStep()}</div><div class="tp-modal-actions"><button class="btn-default" data-action="prevOnboarding" ${state.ui.onboarding.step === 0 ? "disabled" : ""}>Back</button>${state.ui.onboarding.step >= 6 ? '<button class="btn-amber" data-action="createProject">Create Project</button>' : '<button class="btn-amber" data-action="nextOnboarding">Next</button>'}</div></div></div>`;
}

function settingsModal() {
  const d = state.ui.settings.draft;
  if (!state.ui.settings.open || !d) return "";
  const activeProject = getActiveProject();
  const implementationEditable = !activeProject || state.actor !== "pm" || pmCanEditImplementation(activeProject);
  const settingsBuilderPhases = implementationEditable ? PHASE_ORDER : PHASE_ORDER.filter((phaseKey) => phaseKey !== "implementation");
  const selectedSettingsPhase = settingsBuilderPhases.includes(d.newSession?.phase) ? d.newSession.phase : settingsBuilderPhases[0] || "setup";
  return `<div class="tp-modal-overlay is-open"><div class="tp-modal tp-modal-wide"><div class="tp-modal-head"><div><h3>Project Settings</h3><p>Edit metadata and sessions.</p></div><button class="btn-default btn-sm" data-action="closeSettings">Close</button></div><div class="tp-settings-grid"><label class="tp-field"><span>Client</span><input type="text" value="${esc(d.clientName)}" data-bind="settings.clientName"></label><label class="tp-field"><span>Type</span><select data-bind="settings.projectType">${renderTemplateOptions(d.templateOriginKey || d.projectType)}</select></label><label class="tp-field"><span>PM Name</span><input type="text" value="${esc(d.pmName)}" data-bind="settings.pmName"></label><label class="tp-field"><span>PM Email</span><input type="email" value="${esc(d.pmEmail)}" data-bind="settings.pmEmail"></label><label class="tp-field"><span>IS Name</span><input type="text" value="${esc(d.isName)}" data-bind="settings.isName"></label><label class="tp-field"><span>IS Email</span><input type="email" value="${esc(d.isEmail)}" data-bind="settings.isEmail"></label><label class="tp-field"><span>Kick-Off Date</span><input class="tp-mono" type="date" value="${d.projectStart}" data-bind="settings.projectStart"></label><label class="tp-field"><span>Implementation Start</span><input class="tp-mono" type="date" value="${d.implementationStart}" data-bind="settings.implementationStart"></label><label class="tp-field"><span>Go-Live</span><input class="tp-mono" type="date" value="${d.goLiveDate}" data-bind="settings.goLiveDate"></label><label class="tp-field"><span>Hypercare</span><select data-bind="settings.hypercareDuration"><option value="1 week"${d.hypercareDuration === "1 week" ? " selected" : ""}>1 week</option><option value="2 weeks"${d.hypercareDuration === "2 weeks" ? " selected" : ""}>2 weeks</option></select></label><label class="tp-field"><span>Smart Fill Default</span><select data-bind="settings.smartFillPreference"><option value="am"${d.smartFillPreference === "am" ? " selected" : ""}>AM</option><option value="none"${d.smartFillPreference === "none" ? " selected" : ""}>No Preference</option><option value="pm"${d.smartFillPreference === "pm" ? " selected" : ""}>PM</option></select></label><div class="tp-field tp-field-full"><span>Working Days</span>${renderWorkingDaysChips(d.workingDays, "Settings")}</div><div class="tp-summary-card tp-field-full"><p><strong>Suggested Go-Live:</strong> ${esc(fmtDate(d.goLiveSuggestedDate || d.goLiveDate || ""))}</p><p><strong>Recommended Duration:</strong> ${esc(fmtPhaseSpan(d.goLiveRecommendedWeeks))}</p>${d.goLiveWarning ? `<p class="tp-warning-copy">${esc(d.goLiveWarning)}</p>` : '<p class="tp-muted">Suggestion updates when implementation start or working days change.</p>'}</div><label class="tp-field tp-field-full"><span>Invitees</span><textarea rows="3" data-bind="settings.invitees">${esc(Array.isArray(d.invitees) ? d.invitees.join(", ") : d.invitees)}</textarea></label><label class="tp-field tp-field-full"><span>Location</span><input type="text" value="${esc(d.location)}" data-bind="settings.location"></label></div>${!implementationEditable ? '<div class="alert alert-info"><strong>Implementation read-only</strong><div>Implementation sessions are managed by the IS after handoff. Use a new handoff to resend intent.</div></div>' : ""}<div class="tp-settings-list">${PHASE_ORDER.map((phaseKey) => renderSessionRowsForStages(d, phaseKey, "moveSettingsSession", "removeSettingsSession", { editable: phaseKey !== "implementation" || implementationEditable })).join("")}</div><div class="tp-builder-grid"><label class="tp-field tp-field-compact"><span>Name</span><input type="text" value="${esc(d.newSession?.name || "")}" data-bind="settings.newSession.name"></label><label class="tp-field tp-field-compact"><span>Duration</span><input class="tp-mono" type="number" min="15" step="15" value="${d.newSession?.duration || 90}" data-bind="settings.newSession.duration"></label><label class="tp-field tp-field-compact"><span>Phase</span><select data-bind="settings.newSession.phase">${settingsBuilderPhases.map((phaseKey) => `<option value="${phaseKey}"${selectedSettingsPhase === phaseKey ? " selected" : ""}>${esc(PHASE_META[phaseKey].label)}</option>`).join("")}</select></label><label class="tp-field tp-field-compact"><span>Stage</span><select data-bind="settings.newSession.stageKey">${renderStageOptions(d, selectedSettingsPhase, d.newSession?.stageKey || "")}</select></label>${d.newSession?.stageKey === "__new__" || !getPhaseStages(d, selectedSettingsPhase).length ? `<label class="tp-field tp-field-compact"><span>New Stage Label</span><input type="text" value="${esc(d.newSession?.newStageLabel || "")}" data-bind="settings.newSession.newStageLabel"></label>` : ""}<label class="tp-field tp-field-compact"><span>Owner</span><select data-bind="settings.newSession.owner"><option value="pm"${d.newSession?.owner === "pm" ? " selected" : ""}>PM</option><option value="is"${d.newSession?.owner === "is" ? " selected" : ""}>IS</option></select></label><label class="tp-field tp-field-compact"><span>Type</span><select data-bind="settings.newSession.type"><option value="external"${d.newSession?.type === "external" ? " selected" : ""}>External</option><option value="internal"${d.newSession?.type === "internal" ? " selected" : ""}>Internal</option></select></label><button class="btn-amber" data-action="addSettingsSession">Add Session</button></div><div class="tp-modal-actions"><button class="btn-default" data-action="closeSettings">Cancel</button><button class="btn-amber" data-action="saveSettings">Save Project</button></div></div></div>`;
}

function renderTemplateIssueList(title, issues, className = "") {
  if (!issues.length) return "";
  return `<div class="tp-summary-card ${className}"><h4>${esc(title)}</h4><ul class="tp-plain-list">${issues.map((issue) => `<li><strong>${esc(issue.path || "template")}</strong>: ${esc(issue.message)}</li>`).join("")}</ul></div>`;
}

function fmtTemplateOwner(value) {
  if (value === "pm") return "PM";
  if (value === "is") return "IS";
  if (value === "shared") return "Shared";
  return value || "Unassigned";
}

function isTemplateSelection(selection, kind, phaseIndex = -1, stageIndex = -1, sessionIndex = -1) {
  return selection.kind === kind
    && selection.phaseIndex === phaseIndex
    && selection.stageIndex === stageIndex
    && selection.sessionIndex === sessionIndex;
}

function getTemplatePhaseTone(phaseKey) {
  if (phaseKey === "setup") return "is-setup";
  if (phaseKey === "implementation") return "is-implementation";
  if (phaseKey === "hypercare") return "is-hypercare";
  return "";
}

function getTemplatePhaseWeeks(phase) {
  const maxWeeks = Number(phase?.durationWeeks?.max);
  if (Number.isFinite(maxWeeks) && maxWeeks > 0) return maxWeeks;
  const minWeeks = Number(phase?.durationWeeks?.min);
  if (Number.isFinite(minWeeks) && minWeeks > 0) return minWeeks;
  return 1;
}

function getTemplateStageDays(stage) {
  const durationDays = Number(stage?.durationDays);
  if (!Number.isFinite(durationDays)) return 1;
  return Math.max(1, Math.round(durationDays));
}

export function getTemplatePhaseTimelineLayout(phase) {
  const stages = phase?.stages || [];
  const phaseWeeks = getTemplatePhaseWeeks(phase);
  const phaseBaseWidth = Math.max(phaseWeeks * TEMPLATE_TIMELINE_WEEK_WIDTH, TEMPLATE_TIMELINE_MIN_PHASE_WIDTH);
  const totalStageDays = Math.max(1, stages.reduce((total, stage) => total + getTemplateStageDays(stage), 0));
  const stageLayouts = stages.map((stage) => {
    const stageDays = getTemplateStageDays(stage);
    const idealWidth = phaseBaseWidth * (stageDays / totalStageDays);
    return {
      stageDays,
      width: Math.max(TEMPLATE_TIMELINE_MIN_STAGE_WIDTH, Math.round(idealWidth)),
    };
  });
  const phaseWidth = Math.max(
    phaseBaseWidth,
    stageLayouts.reduce((total, layout) => total + layout.width, 0) + ((stages.length + 1) * TEMPLATE_TIMELINE_STAGE_DROP_WIDTH)
  );

  return {
    phaseWeeks,
    phaseBaseWidth,
    phaseWidth,
    totalStageDays,
    stageLayouts,
  };
}

function renderTemplateSessionCard(phase, phaseIndex, stageIndex, session, sessionIndex, selection) {
  const selected = isTemplateSelection(selection, "session", phaseIndex, stageIndex, sessionIndex);
  const badges = [
    `<span class="badge ${session.type === "internal" ? "badge-int" : "badge-ext"}">${esc(session.type)}</span>`,
    `<span class="badge ${session.owner === "is" ? "badge-is" : session.owner === "shared" ? "badge-pm" : "badge-pm"}">${esc(fmtTemplateOwner(session.owner || phase.owner))}</span>`,
    session.locked ? '<span class="badge badge-golive">Locked</span>' : "",
    session.gating?.type === "phase_gate" ? '<span class="badge badge-next">Gate</span>' : "",
  ].join("");

  return `<article class="tp-template-session-card${selected ? " is-selected" : ""}" draggable="true" data-drag="template-session" data-phase-index="${phaseIndex}" data-stage-index="${stageIndex}" data-session-index="${sessionIndex}" data-template-session-key="${esc(session.key || "")}" style="height:${TEMPLATE_TIMELINE_SESSION_CARD_HEIGHT}px;min-height:${TEMPLATE_TIMELINE_SESSION_CARD_HEIGHT}px;">
    <button class="tp-template-session-select" type="button" data-action="selectTemplateEditorEntity" data-entity-kind="session" data-phase-index="${phaseIndex}" data-stage-index="${stageIndex}" data-session-index="${sessionIndex}">
      <span class="tp-template-session-title">${esc(session.name || "Session")}</span>
      <span class="tp-template-session-meta">${esc(`${fmtDur(Number(session.durationMinutes) || 0)} | ${session.key || "no_key"}`)}</span>
      <span class="tp-template-session-badges">${badges}</span>
    </button>
  </article>`;
}

function renderTemplateStageColumn(phase, phaseIndex, stage, stageIndex, selection, layout) {
  const selected = isTemplateSelection(selection, "stage", phaseIndex, stageIndex);
  const sessions = stage.sessions || [];
  const dropSlots = [];
  for (let slotIndex = 0; slotIndex <= sessions.length; slotIndex += 1) {
    dropSlots.push(`<div class="tp-template-session-drop" data-drop-template-session data-phase-index="${phaseIndex}" data-target-phase-index="${phaseIndex}" data-target-stage-index="${stageIndex}" data-target-session-index="${slotIndex}" aria-hidden="true"></div>`);
    if (slotIndex < sessions.length) {
      dropSlots.push(renderTemplateSessionCard(phase, phaseIndex, stageIndex, sessions[slotIndex], slotIndex, selection));
    }
  }

  return `<section class="tp-template-stage-column${selected ? " is-selected" : ""}" draggable="true" data-drag="template-stage" data-phase-index="${phaseIndex}" data-stage-index="${stageIndex}" data-template-stage-days="${layout.stageDays}" data-template-stage-width="${layout.width}" style="width:${layout.width}px;min-width:${TEMPLATE_TIMELINE_MIN_STAGE_WIDTH}px;">
    <button class="tp-template-stage-header" type="button" data-action="selectTemplateEditorEntity" data-entity-kind="stage" data-phase-index="${phaseIndex}" data-stage-index="${stageIndex}">
      <span class="tp-template-stage-title">${esc(stage.label || "Stage")}</span>
      <span class="tp-template-stage-meta">${esc(stage.key || "")}</span>
      <span class="tp-template-stage-count">${esc(`${layout.stageDays} day${layout.stageDays === 1 ? "" : "s"} | ${sessions.length} session${sessions.length === 1 ? "" : "s"}`)}</span>
    </button>
    <div class="tp-template-session-stack" data-template-stage-body>
      ${dropSlots.join("") || `<div class="tp-template-session-drop" data-drop-template-session data-phase-index="${phaseIndex}" data-target-phase-index="${phaseIndex}" data-target-stage-index="${stageIndex}" data-target-session-index="0" aria-hidden="true"></div>`}
    </div>
    <div class="tp-template-stage-footer"><button class="btn-default btn-sm" data-action="addTemplateSession" data-phase-index="${phaseIndex}" data-stage-index="${stageIndex}">Add Session</button></div>
  </section>`;
}

function renderTemplatePhaseLane(phase, phaseIndex, selection) {
  const layout = getTemplatePhaseTimelineLayout(phase);
  const stages = phase.stages || [];
  const selected = isTemplateSelection(selection, "phase", phaseIndex);
  const stageColumns = [];
  for (let slotIndex = 0; slotIndex <= stages.length; slotIndex += 1) {
    stageColumns.push(`<div class="tp-template-stage-drop" data-drop-template-stage data-phase-index="${phaseIndex}" data-target-phase-index="${phaseIndex}" data-target-index="${slotIndex}" aria-hidden="true"></div>`);
    if (slotIndex < stages.length) {
      stageColumns.push(renderTemplateStageColumn(phase, phaseIndex, stages[slotIndex], slotIndex, selection, layout.stageLayouts[slotIndex]));
    }
  }

  return `<section class="tp-template-phase-lane ${getTemplatePhaseTone(phase.key)}" data-template-phase="${esc(phase.key)}" data-template-phase-weeks="${layout.phaseWeeks}" data-template-phase-base-width="${layout.phaseBaseWidth}" data-template-phase-width="${layout.phaseWidth}" style="width:${layout.phaseWidth}px;min-width:${layout.phaseWidth}px;">
    <div class="tp-template-phase-head">
      <button class="tp-template-phase-button${selected ? " is-selected" : ""}" type="button" data-action="selectTemplateEditorEntity" data-entity-kind="phase" data-phase-index="${phaseIndex}">
        <span class="tp-template-phase-title">${esc(phase.label || phase.key || `Phase ${phaseIndex + 1}`)}</span>
        <span class="tp-template-phase-meta">${esc(`${fmtTemplateOwner(phase.owner)} | ${phase.calendarSource?.toUpperCase?.() || phase.calendarSource || "PM"} calendar | ${fmtWeekRange(phase.durationWeeks?.min, phase.durationWeeks?.max) || "No duration"} | ${layout.phaseWeeks}w scale`)}</span>
      </button>
      <div class="tp-template-phase-actions"><button class="btn-default btn-sm" data-action="addTemplateStage" data-phase-index="${phaseIndex}">Add Stage</button></div>
    </div>
    <div class="tp-template-phase-body">
      <div class="tp-template-stage-grid">
        ${stageColumns.join("")}
      </div>
    </div>
  </section>`;
}

function renderTemplateMetadataInspector(draft) {
  return `<div class="tp-template-inspector-fields">
    <label class="tp-field"><span>Template Key</span><input type="text" value="${esc(draft.key || "")}" data-bind="templateEditor.key"></label>
    <label class="tp-field"><span>Template Label</span><input type="text" value="${esc(draft.label || "")}" data-bind="templateEditor.label"></label>
    <label class="tp-field"><span>Version</span><input type="text" value="${esc(draft.metadata?.version || "")}" data-bind="templateEditor.metadata.version"></label>
    <label class="tp-field"><span>Author</span><input type="text" value="${esc(draft.metadata?.author || "")}" data-bind="templateEditor.metadata.author"></label>
    <label class="tp-field"><span>Created</span><input type="text" value="${esc(draft.metadata?.created || "")}" data-bind="templateEditor.metadata.created"></label>
    <label class="tp-field"><span>Modified</span><input type="text" value="${esc(draft.metadata?.modified || "")}" data-bind="templateEditor.metadata.modified"></label>
  </div>`;
}

function renderTemplatePhaseInspector(phase, phaseIndex) {
  if (!phase) return "";
  return `<div class="tp-template-inspector-fields">
    <label class="tp-field"><span>Phase Label</span><input type="text" value="${esc(phase.label || "")}" data-bind="templateEditor.phase.${phaseIndex}.label"></label>
    <label class="tp-field"><span>Owner</span><select data-bind="templateEditor.phase.${phaseIndex}.owner"><option value="pm"${phase.owner === "pm" ? " selected" : ""}>PM</option><option value="is"${phase.owner === "is" ? " selected" : ""}>IS</option><option value="shared"${phase.owner === "shared" ? " selected" : ""}>Shared</option></select></label>
    <label class="tp-field"><span>Calendar Source</span><select data-bind="templateEditor.phase.${phaseIndex}.calendarSource"><option value="pm"${phase.calendarSource === "pm" ? " selected" : ""}>PM</option><option value="is"${phase.calendarSource === "is" ? " selected" : ""}>IS</option><option value="shared"${phase.calendarSource === "shared" ? " selected" : ""}>Shared</option></select></label>
    <label class="tp-field"><span>Min Weeks</span><input class="tp-mono" type="number" min="0" step="1" value="${phase.durationWeeks?.min ?? ""}" data-bind="templateEditor.phase.${phaseIndex}.durationWeeks.min"></label>
    <label class="tp-field"><span>Max Weeks</span><input class="tp-mono" type="number" min="0" step="1" value="${phase.durationWeeks?.max ?? ""}" data-bind="templateEditor.phase.${phaseIndex}.durationWeeks.max"></label>
  </div>`;
}

function renderTemplateStageInspector(stage, phaseIndex, stageIndex) {
  if (!stage) return "";
  return `<div class="tp-template-inspector-fields">
    <label class="tp-field"><span>Stage Key</span><input type="text" value="${esc(stage.key || "")}" data-bind="templateEditor.stage.${phaseIndex}.${stageIndex}.key"></label>
    <label class="tp-field"><span>Stage Label</span><input type="text" value="${esc(stage.label || "")}" data-bind="templateEditor.stage.${phaseIndex}.${stageIndex}.label"></label>
    <label class="tp-field"><span>Duration Days</span><input class="tp-mono" type="number" min="1" step="1" value="${Number(stage.durationDays || 1)}" data-bind="templateEditor.stage.${phaseIndex}.${stageIndex}.durationDays"></label>
    <div class="tp-quick-row">
      <button class="btn-default btn-sm" data-action="moveTemplateStage" data-phase-index="${phaseIndex}" data-stage-index="${stageIndex}" data-dir="-1">Move Left</button>
      <button class="btn-default btn-sm" data-action="moveTemplateStage" data-phase-index="${phaseIndex}" data-stage-index="${stageIndex}" data-dir="1">Move Right</button>
      <button class="btn-danger btn-sm" data-action="removeTemplateStage" data-phase-index="${phaseIndex}" data-stage-index="${stageIndex}">Remove Stage</button>
    </div>
  </div>`;
}

function renderTemplateSessionInspector(phase, stage, session, phaseIndex, stageIndex, sessionIndex) {
  if (!session) return "";
  const predecessorOptions = (phase.stages || [])
    .flatMap((candidateStage) => candidateStage.sessions || [])
    .filter((candidate) => candidate !== session && candidate.key)
    .map((candidate) => `<option value="${candidate.key}"${session.gating?.ref === candidate.key ? " selected" : ""}>${esc(candidate.name || candidate.key)}</option>`)
    .join("");

  return `<div class="tp-template-inspector-fields">
    <label class="tp-field"><span>Key</span><input type="text" value="${esc(session.key || "")}" data-bind="templateEditor.session.${phaseIndex}.${stageIndex}.${sessionIndex}.key"></label>
    <label class="tp-field"><span>Name</span><input type="text" value="${esc(session.name || "")}" data-bind="templateEditor.session.${phaseIndex}.${stageIndex}.${sessionIndex}.name"></label>
    <label class="tp-field"><span>Duration Minutes</span><input class="tp-mono" type="number" min="15" step="15" value="${Number(session.durationMinutes || 90)}" data-bind="templateEditor.session.${phaseIndex}.${stageIndex}.${sessionIndex}.durationMinutes"></label>
    <label class="tp-field"><span>Owner</span><select data-bind="templateEditor.session.${phaseIndex}.${stageIndex}.${sessionIndex}.owner"><option value="pm"${session.owner === "pm" ? " selected" : ""}>PM</option><option value="is"${session.owner === "is" ? " selected" : ""}>IS</option><option value="shared"${session.owner === "shared" ? " selected" : ""}>Shared</option></select></label>
    <label class="tp-field"><span>Type</span><select data-bind="templateEditor.session.${phaseIndex}.${stageIndex}.${sessionIndex}.type"><option value="external"${session.type === "external" ? " selected" : ""}>External</option><option value="internal"${session.type === "internal" ? " selected" : ""}>Internal</option></select></label>
    <label class="tp-field"><span>bodyKey</span><input type="text" value="${esc(session.bodyKey || "")}" data-bind="templateEditor.session.${phaseIndex}.${stageIndex}.${sessionIndex}.bodyKey"></label>
    <label class="tp-field"><span>Locked</span><input type="checkbox" ${session.locked ? "checked" : ""} data-bind="templateEditor.session.${phaseIndex}.${stageIndex}.${sessionIndex}.locked"></label>
    <label class="tp-field"><span>Gating</span><select data-bind="templateEditor.session.${phaseIndex}.${stageIndex}.${sessionIndex}.gating.type"><option value="none"${!session.gating ? " selected" : ""}>None</option><option value="phase_gate"${session.gating?.type === "phase_gate" ? " selected" : ""}>Phase Gate</option><option value="predecessor"${session.gating?.type === "predecessor" ? " selected" : ""}>Predecessor</option></select></label>
    ${session.gating?.type === "predecessor" ? `<label class="tp-field"><span>Predecessor Ref</span><select data-bind="templateEditor.session.${phaseIndex}.${stageIndex}.${sessionIndex}.gating.ref"><option value="">Select</option>${predecessorOptions}</select></label>` : ""}
    <div class="tp-quick-row">
      <button class="btn-default btn-sm" data-action="moveTemplateSession" data-phase-index="${phaseIndex}" data-stage-index="${stageIndex}" data-session-index="${sessionIndex}" data-dir="-1">Move Up</button>
      <button class="btn-default btn-sm" data-action="moveTemplateSession" data-phase-index="${phaseIndex}" data-stage-index="${stageIndex}" data-session-index="${sessionIndex}" data-dir="1">Move Down</button>
      <button class="btn-danger btn-sm" data-action="removeTemplateSession" data-phase-index="${phaseIndex}" data-stage-index="${stageIndex}" data-session-index="${sessionIndex}">Remove Session</button>
    </div>
    <p class="tp-template-inspector-note">${esc(`Stage: ${stage?.label || stage?.key || "Unknown"} | Phase: ${phase?.label || phase?.key || "Unknown"}`)}</p>
  </div>`;
}

function renderTemplateInspector(draft) {
  const entity = getTemplateEditorEntity();
  const selection = getTemplateEditorSelection();
  let title = "Template";
  let meta = "Template metadata and export controls";
  let body = renderTemplateMetadataInspector(draft);

  if (entity.kind === "phase" && entity.phase) {
    title = entity.phase.label || entity.phase.key || "Phase";
    meta = `Phase ${selection.phaseIndex + 1}`;
    body = renderTemplatePhaseInspector(entity.phase, selection.phaseIndex);
  } else if (entity.kind === "stage" && entity.stage) {
    title = entity.stage.label || entity.stage.key || "Stage";
    meta = entity.phase?.label || entity.phase?.key || "Stage";
    body = renderTemplateStageInspector(entity.stage, selection.phaseIndex, selection.stageIndex);
  } else if (entity.kind === "session" && entity.session) {
    title = entity.session.name || entity.session.key || "Session";
    meta = entity.stage?.label || entity.stage?.key || "Session";
    body = renderTemplateSessionInspector(entity.phase, entity.stage, entity.session, selection.phaseIndex, selection.stageIndex, selection.sessionIndex);
  }

  return `<aside class="tp-template-inspector">
    <div class="tp-template-inspector-card">
      <div class="tp-template-inspector-head">
        <div class="tp-eyebrow">Inspector</div>
        <h3>${esc(title)}</h3>
        <p>${esc(meta)}</p>
      </div>
      ${body}
      <div class="tp-template-inspector-actions">
        ${state.ui.templateEditor.mode === "library" ? `<button class="btn-amber" data-action="exportTemplateLibrary">Export session-templates.js</button>` : `<button class="btn-amber" data-action="applyOneOffTemplate">Apply To Project</button>`}
      </div>
    </div>
  </aside>`;
}

function templateEditorScreen() {
  const draft = state.ui.templateEditor.draft;
  const preview = getTemplateEditorPreview();
  const templateOptions = getTemplateOptionList();
  if (!draft) {
    return `<main class="tp-screen"><section class="tp-empty-card"><h2>No template selected</h2><p>Choose a template to edit.</p></section></main>`;
  }

  return `<main class="tp-screen">
    <section class="tp-screen-head">
      <div>
        <div class="tp-eyebrow">${state.ui.templateEditor.mode === "oneoff" ? "Onboarding One-Off Template" : "Template Library"}</div>
        <h1>${esc(draft.label || "Template Editor")}</h1>
      </div>
      <div class="tp-quick-row">
        ${state.ui.templateEditor.mode === "library" ? `<button class="btn-default" data-action="createTemplateEditorTemplate">New Template</button><button class="btn-default" data-action="duplicateTemplateEditorTemplate">Duplicate</button>` : ""}
      </div>
    </section>
    <section class="tp-template-editor">
      <div class="tp-template-canvas-pane">
        <div class="tp-summary-card tp-template-toolbar">
          ${state.ui.templateEditor.mode === "library" ? `<label class="tp-field"><span>Template</span><select data-action="selectTemplateEditorTemplate">${templateOptions.map((template, index) => `<option value="${index}"${index === state.ui.templateEditor.activeTemplateIndex ? " selected" : ""}>${esc(template.label)}</option>`).join("")}</select></label>` : `<div class="tp-template-toolbar-note"><strong>${esc(draft.label || "Template")}</strong><span>One-off customization mode</span></div>`}
        <div class="tp-template-toolbar-copy">
          <strong>Graph Builder</strong>
          <span>Time flows left to right. Drag stages and sessions within their phase timeline, then refine details in the inspector.</span>
        </div>
      </div>
      <div class="tp-template-graph-scroll" data-template-graph-scroll>
        <section class="tp-template-graph" data-template-graph>
          ${draft.phases.map((phase, phaseIndex) => renderTemplatePhaseLane(phase, phaseIndex, getTemplateEditorSelection())).join("")}
        </section>
      </div>
      ${renderTemplateIssueList("Validation Errors", state.ui.templateEditor.validation.errors, "is-danger")}
        ${renderTemplateIssueList("Validation Warnings", state.ui.templateEditor.validation.warnings, "is-warning")}
        ${preview ? `<section class="tp-summary-card"><h4>Preview</h4>${preview.phases.map((phase) => `<div class="tp-settings-phase"><h4>${esc(phase.label)}</h4><p>${esc(`${phase.ownerLabel || phase.owner} | ${fmtWeekRange(phase.durationWeeks?.min, phase.durationWeeks?.max) || "No duration"}`)}</p><p>${esc(`${phase.sessions.length} sessions | ${fmtDur(phase.totalMinutes)}`)}</p>${phase.stages.map((stage) => `<div class="tp-settings-row"><div><strong>${esc(stage.label)}</strong><small>${esc(stage.sessions.map((session) => session.name).join(" | "))}</small></div></div>`).join("")}</div>`).join("")}</section>` : ""}
        ${state.ui.templateEditor.exportSource ? `<section class="tp-template-review"><h4>Export Preview</h4><pre>${esc(state.ui.templateEditor.exportSource)}</pre></section>` : ""}
      </div>
      ${renderTemplateInspector(draft)}
    </section>
  </main>`;
}

function windowChangeDialog() {
  const dialog = state.ui.windowChangeDialog;
  if (!dialog.open) return "";
  return `<div class="tp-modal-overlay is-open"><div class="tp-modal"><div class="tp-modal-head"><div><h3>Window Update Review</h3><p>${esc(`${dialog.affectedCount} sessions fall outside the updated window. Clear their dates and re-run Smart Fill, or leave them and resolve conflicts manually.`)}</p></div></div><div class="tp-modal-actions"><button class="btn-default" data-action="confirmWindowChangeKeep">Keep and Review</button><button class="btn-amber" data-action="confirmWindowChangeClear">Clear Affected Dates</button></div></div></div>`;
}

function shiftDialog() {
  const dialog = state.ui.shiftDialog;
  if (!dialog.open) return "";
  return `<div class="tp-modal-overlay is-open"><div class="tp-modal"><div class="tp-modal-head"><div><h3>Shift Remaining Sessions?</h3><p>Move only this session, or shift all remaining sessions in this phase?</p></div></div><div class="tp-modal-actions"><button class="btn-default" data-action="dismissShiftDialog">Move Only</button><button class="btn-amber" data-action="confirmShiftRemaining">Shift Remaining</button></div></div></div>`;
}

function deleteProjectDialog() {
  const dialog = state.ui.deleteDialog;
  if (!dialog.open) return "";
  return `<div class="tp-modal-overlay is-open"><div class="tp-modal"><div class="tp-modal-head"><div><h3>Delete Project</h3><p>Permanently delete <strong>${esc(dialog.projectName)}</strong>? This removes all sessions and cannot be undone.</p></div></div><div class="tp-modal-actions"><button class="btn-default" data-action="dismissDeleteProject">Cancel</button><button class="btn-danger" data-action="confirmDeleteProject">Delete Project</button></div></div></div>`;
}

function closeProjectDialog() {
  const dialog = state.ui.closeDialog;
  if (!dialog.open) return "";
  return `<div class="tp-modal-overlay is-open"><div class="tp-modal"><div class="tp-modal-head"><div><h3>Close Project</h3><p>Close <strong>${esc(dialog.projectName)}</strong>? Future calendar events will be removed from your calendar and the IS will be notified to clean up theirs.</p></div></div><div class="tp-modal-actions"><button class="btn-default" data-action="dismissCloseProject">Cancel</button><button class="btn-danger" data-action="confirmCloseProject">Close Project</button></div></div></div>`;
}

function projectErrorModal() {
  if (!state.ui.projectError.open) return "";
  return `<div class="tp-modal-overlay is-open"><div class="tp-modal"><div class="tp-modal-head"><div><h3>Could Not Load Projects</h3><p>${esc(state.ui.projectError.message)}</p></div><button class="btn-default btn-sm" data-action="dismissProjectError">Close</button></div><pre class="tp-error-pre">${esc(state.ui.projectError.details || "No diagnostic detail available.")}</pre><div class="tp-modal-actions"><button class="btn-default" data-action="dismissProjectError">Close</button><button class="btn-danger" data-action="resetSentinel">Reset Sentinel</button></div></div></div>`;
}

function escapeSelectorValue(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function captureSlotFocus(slot) {
  if (typeof document === "undefined" || !slot || typeof slot.contains !== "function") return null;

  const active = document.activeElement;
  if (!active || !slot.contains(active) || typeof active.matches !== "function") return null;
  if (!active.matches("input, textarea, select")) return null;

  let selectionStart = null;
  let selectionEnd = null;
  try {
    if (typeof active.selectionStart === "number" && typeof active.selectionEnd === "number") {
      selectionStart = active.selectionStart;
      selectionEnd = active.selectionEnd;
    }
  } catch (error) {
    // Ignore controls that do not expose selection APIs.
  }

  return {
    id: active.id || "",
    dataBind: active.getAttribute("data-bind") || "",
    dataAction: active.getAttribute("data-action") || "",
    dataId: active.getAttribute("data-id") || "",
    selectionStart,
    selectionEnd,
  };
}

function findFocusedReplacement(slot, focusState) {
  if (!slot || !focusState) return null;

  if (focusState.id) {
    return slot.querySelector(`#${escapeSelectorValue(focusState.id)}`);
  }

  if (focusState.dataBind) {
    return slot.querySelector(`[data-bind="${escapeSelectorValue(focusState.dataBind)}"]`);
  }

  if (focusState.dataAction && focusState.dataId) {
    return slot.querySelector(`[data-action="${escapeSelectorValue(focusState.dataAction)}"][data-id="${escapeSelectorValue(focusState.dataId)}"]`);
  }

  if (focusState.dataAction) {
    return slot.querySelector(`[data-action="${escapeSelectorValue(focusState.dataAction)}"]`);
  }

  return null;
}

function restoreSlotFocus(slot, focusState) {
  const next = findFocusedReplacement(slot, focusState);
  if (!next || typeof next.focus !== "function") return;

  next.focus({ preventScroll: true });
  if (
    typeof next.setSelectionRange === "function"
    && typeof focusState.selectionStart === "number"
    && typeof focusState.selectionEnd === "number"
  ) {
    try {
      next.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
    } catch (error) {
      // Ignore controls that cannot restore selection.
    }
  }
}

export function updateRenderSlot(slot, html) {
  if (!slot) return false;

  const nextHTML = html || "";
  if ((slot.dataset?.renderHtml || "") === nextHTML) return false;

  const focusState = captureSlotFocus(slot);
  slot.innerHTML = nextHTML;
  if (slot.dataset) {
    slot.dataset.renderHtml = nextHTML;
  }
  if (focusState) {
    restoreSlotFocus(slot, focusState);
  }
  return true;
}

function ensureRenderShell(app) {
  if (
    app.dataset.renderShell !== "1"
    || !app.querySelector("#tp-slot-topbar")
    || !app.querySelector("#tp-slot-main")
    || !app.querySelector("#tp-slot-overlays")
    || !app.querySelector("#toast")
  ) {
    app.innerHTML = RENDER_SHELL_HTML;
    app.dataset.renderShell = "1";
  }

  return {
    topbar: app.querySelector("#tp-slot-topbar"),
    main: app.querySelector("#tp-slot-main"),
    overlays: app.querySelector("#tp-slot-overlays"),
  };
}

export function buildRenderSnapshot() {
  const project = getActiveProject();
  return {
    topbar: state.ui.screen === "auth" ? "" : topbar(),
    main:
      state.ui.screen === "auth"
        ? authScreen()
        : state.ui.screen === "templates"
          ? templateEditorScreen()
          : state.ui.screen === "workspace" && project
            ? workspace(project)
            : projectsScreen(),
    overlays: `${onboardingModal()}${settingsModal()}${windowChangeDialog()}${shiftDialog()}${deleteProjectDialog()}${closeProjectDialog()}${projectErrorModal()}${renderDayViewModal()}`,
  };
}

export function render() {
  const app = document.getElementById("app");
  if (!app) return;

  const slots = ensureRenderShell(app);
  const snapshot = buildRenderSnapshot();
  updateRenderSlot(slots.topbar, snapshot.topbar);
  updateRenderSlot(slots.main, snapshot.main);
  updateRenderSlot(slots.overlays, snapshot.overlays);
}
