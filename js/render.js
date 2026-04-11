import { getConflictSummary, getSessionConflicts, summarizeConflictKinds } from "./conflicts.js";
import { renderDayViewModal } from "./dayview.js";
import { getActiveProject, state } from "./state.js";
import {
  canCommitSession,
  canEditSession,
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
  getTimelineSuggestion,
  getVisiblePhaseKeys,
  PHASE_META,
  PHASE_ORDER,
  PROJECT_TYPE_META,
  STATUS_META,
} from "./projects.js";
import { getSmartAvailabilityState, readyForHandoff } from "./scheduler.js";
import { esc, fmt12, fmtDur, getTimeOptionsHTML, mondayOf, parseDate, timeAgo, toDateStr } from "./utils.js";

const DURATION_OPTIONS = [30, 45, 60, 90, 120, 150, 180, 240, 480];
const STATUS_PRIORITY = { scheduling: 0, pending_is_commit: 1, active: 2, complete: 3, closed: 4 };
const ARCHIVE_STATUSES = new Set(["complete", "closed"]);
const KANBAN_COLUMNS = [
  { key: "scheduling", label: "Scheduling", phase: "scheduling" },
  { key: "setup", label: "Setup", phase: "setup" },
  { key: "training", label: "Training", phase: "implementation" },
  { key: "go_live_prep", label: "Go-Live Prep", phase: "implementation" },
  { key: "go_live", label: "Go-Live", phase: "implementation" },
  { key: "hypercare", label: "Hypercare", phase: "hypercare" },
];

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

function getPhaseBadgeClass(phaseKey) {
  if (phaseKey === "setup") return "badge-setup";
  if (phaseKey === "implementation") return "badge-impl";
  if (phaseKey === "hypercare") return "badge-hypercare";
  return "badge-int";
}

function getColumnBadgeClass(columnKey) {
  if (columnKey === "setup") return "badge-setup";
  if (columnKey === "training" || columnKey === "go_live_prep") return "badge-training";
  if (columnKey === "go_live") return "badge-golive";
  if (columnKey === "hypercare") return "badge-hypercare";
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

function renderStageOptions(source, phaseKey, selectedStageKey) {
  const stages = getPhaseStages(source, phaseKey);
  const hasSelected = stages.some((stage) => stage.key === selectedStageKey);
  const nextValue = selectedStageKey && hasSelected ? selectedStageKey : stages[0]?.key || "__new__";
  return `${stages
    .map((stage) => `<option value="${stage.key}"${nextValue === stage.key ? " selected" : ""}>${esc(stage.label)}</option>`)
    .join("")}<option value="__new__"${nextValue === "__new__" ? " selected" : ""}>Create New Stage</option>`;
}

function renderSessionRowsForStages(source, phaseKey, moveAction, removeAction) {
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
            )} | ${session.owner === "is" ? "IS" : "PM"} | ${esc(session.type)}</small></div><div class="tp-quick-row">${session.lockedDate ? '<span class="tp-pill tp-pill-muted">System Managed</span>' : `<button class="btn-default btn-sm" data-action="${moveAction}" data-id="${session.id}" data-dir="-1">Up</button><button class="btn-default btn-sm" data-action="${moveAction}" data-id="${session.id}" data-dir="1">Down</button><button class="btn-danger btn-sm" data-action="${removeAction}" data-id="${session.id}">Remove</button>`}</div></div>`
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
  const name = state.graphAccount?.name || state.graphAccount?.username || "Microsoft 365";
  const inWorkspace = state.ui.screen === "workspace" && project;
  const projectStatus = inWorkspace ? deriveProjectStatus(project) : "";
  const canClose = inWorkspace && state.actor === "pm" && !["scheduling", "complete", "closed"].includes(projectStatus);
  const breadcrumb = inWorkspace
    ? `Projects / <span class="tp-nav-crumb-current">${esc(project.clientName || "Untitled Project")}</span>`
    : '<span class="tp-nav-crumb-current">Projects</span>';
  const workspaceActions = !inWorkspace
    ? ""
    : `${state.actor === "pm" ? '<button class="btn-default" data-action="backToProjects">Projects</button>' : ""}${
        project.closedAt
          ? ""
          : `${conflictButton(project)}<button class="btn-amber" data-action="pushOwned">${state.actor === "is" ? "Commit to Calendar" : "Push All"}</button>${
              state.actor === "pm" && readyForHandoff(project) ? '<button class="btn-default" data-action="handoffToIs">Hand Off to IS</button>' : ""
            }${state.actor === "pm" ? '<button class="btn-ghost" data-action="generateClientPlan">Client Plan</button>' : ""}<button class="btn-ghost" data-action="openSettings">Project Settings</button>${
              canClose ? `<button class="btn-danger btn-sm" data-action="closeProject" data-id="${project.id}" data-name="${esc(project.clientName || "Untitled Project")}">Close Project</button>` : ""
            }${
              state.actor === "pm" && projectStatus === "scheduling"
                ? `<button class="btn-danger btn-sm" data-action="deleteProject" data-id="${project.id}" data-name="${esc(project.clientName || "Untitled Project")}">Delete</button>`
                : ""
            }`
      }`;
  return `<header class="tp-nav">
    <div class="tp-nav-mark">TP</div>
    <div class="tp-nav-copy"><strong class="tp-nav-title">Training Planner</strong><span class="tp-nav-sub">${state.actor === "is" ? "IS View" : "PM View"}</span></div>
    <div class="tp-nav-sep"></div>
    <div class="tp-nav-crumb">${breadcrumb}</div>
    <div class="tp-nav-spacer"></div>
    <div class="tp-nav-actions">
      ${workspaceActions}
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
  if (status === "scheduling") return "scheduling";
  const today = toDateStr(new Date());
  const allSessions = getAllSessions(project);
  const future = allSessions
    .filter((s) => s.date && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99"));
  const next = future[0];
  if (!next) {
    const undated = allSessions.filter((s) => !s.date);
    if (undated.length) return undated[0].phase === "implementation" ? (undated[0].stageKey || "training") : undated[0].phase;
    return "hypercare";
  }
  return next.phase === "implementation" ? (next.stageKey || "training") : next.phase;
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
  const canDelete = status === "scheduling";
  const nextLabel = next ? `${fmtDate(next.date).replace(/ \d{4}$/, "")} \u00B7 ${next.name}` : "Not scheduled";
  return `<button class="tp-project-card${archived ? " is-archived" : ""}" data-action="selectProject" data-id="${project.id}">
    <div class="tp-project-card-head"><strong>${esc(project.clientName || "Untitled")}</strong>${canDelete ? `<span class="tp-card-delete" data-action="deleteProject" data-id="${project.id}" data-name="${esc(project.clientName || "Untitled")}" title="Delete">&times;</span>` : ""}</div>
    <span class="tp-project-next">${esc(nextLabel)}</span>
    <div class="tp-project-progress"><div class="tp-project-progress-bar" style="width:${progress.percent}%"></div></div>
    <span class="tp-project-meta">${progress.total ? `${progress.percent}% impl` : ""}${progress.total && countdown ? " \u00B7 " : ""}${esc(countdown)}</span>
  </button>`;
}

function projectsScreen() {
  const search = (state.ui.projectSearch || "").toLowerCase().trim();
  const archivedCount = state.projects.filter((p) => ARCHIVE_STATUSES.has(p.status || "scheduling")).length;

  const visible = state.projects
    .filter((project) => {
      if (!state.ui.showArchived && ARCHIVE_STATUSES.has(project.status || "scheduling")) return false;
      if (search) {
        const haystack = `${project.clientName} ${project.isName} ${project.isEmail} ${project.pmName}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => (a.goLiveDate || "9999").localeCompare(b.goLiveDate || "9999"));

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
    for (const col of KANBAN_COLUMNS) columns.set(col.key, []);
    for (const project of projects) {
      const colKey = getProjectKanbanColumn(project);
      const target = columns.get(colKey) || columns.get("setup");
      target.push(project);
    }

    const boardHTML = KANBAN_COLUMNS.map((col) => {
      const cards = columns.get(col.key) || [];
      return `<div class="tp-kanban-column">
        <div class="tp-kanban-header ${getColumnBadgeClass(col.key)}"><span>${esc(col.label)}</span>${cards.length ? `<span class="tp-kanban-count">${cards.length}</span>` : ""}</div>
        ${cards.map((p) => kanbanCard(p, ARCHIVE_STATUSES.has(p.status))).join("")}
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
      <button class="btn-amber" data-action="openOnboarding">New Project</button>
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

function sidebar(project) {
  const range = getProjectDateRange(project);
  const availability = getSmartAvailabilityState(project, state.actor);
  const availabilityMessage = getAvailabilityMessage(project, availability);
  return `<aside class="tp-sidebar">
    <section class="tp-side-card">
      <div class="tp-card-top">
        <span class="tp-pill">${esc(PROJECT_TYPE_META[project.projectType])}</span>
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
    </section>
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

function phaseSection(project, phaseKey, context = false, nextUpId = "") {
  const stages = getPhaseStages(project, phaseKey).filter((stage) => (stage.sessions || []).length);
  if (!stages.length) return "";
  const summary = getPhaseSummary(project, phaseKey);
  const owner = getActorDisplayName(project, PHASE_META[phaseKey].owner);
  const suggested = fmtWeekRange(summary.suggestedWeeksMin, summary.suggestedWeeksMax);
  const header = phaseKey === "implementation"
    ? `<div class="tp-phase-banner"><span class="tp-phase-banner-label">Implementation</span><span class="tp-phase-banner-meta">${esc(owner)} | ${summary.scheduled} / ${summary.total} scheduled${suggested ? ` | ${esc(suggested)}` : ""}</span></div>`
    : `<header class="tp-phase-header">
      <div><div class="tp-phase-title">${esc(PHASE_META[phaseKey].label)}</div><p class="tp-phase-meta">${esc(owner)} | ${summary.scheduled} / ${summary.total} scheduled</p></div>
      <div class="tp-phase-range"><strong>${esc(fmtPhaseSpan(summary.spanWeeks))}</strong>${suggested ? ` <span>${esc(suggested)}</span>` : ""}${summary.exceedsSuggestedMax ? ' <span class="tp-pill tp-pill-warn">Over suggested</span>' : ""}</div>
    </header>`;
  return `<section class="tp-phase-section${context ? " tp-phase-context" : ""}">
    ${header}
    <div class="tp-phase-list">${stages
      .map(
        (stage) => `<section class="tp-stage-group"><header class="tp-stage-head"><h4>${esc(stage.label)}</h4>${stage.rangeStart || stage.rangeEnd ? `<span class="tp-stage-range">${esc(fmtRange(stage.rangeStart, stage.rangeEnd))}</span>` : ""}</header>${stage.sessions
          .map((currentSession) => sessionRow(project, currentSession, context, !context && currentSession.id === nextUpId))
          .join("")}</section>`
      )
      .join("")}</div>
  </section>`;
}

function sessionPanel(project) {
  const today = toDateStr(new Date());
  const allProjectSessions = getAllSessions(project);
  const nextUpSession = allProjectSessions
    .filter((s) => s.date && s.date >= today && s.time)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""))[0] || null;
  const nextUpId = nextUpSession?.id || "";
  const visible = getVisiblePhaseKeys(state.actor);
  const context = getContextPhaseKeys(state.actor);
  return `<section class="tp-main">
    <div class="tp-main-header"><div class="tp-main-title">${esc(project.clientName)}</div><div class="tp-main-sub">${esc(PROJECT_TYPE_META[project.projectType])} | ${esc(getProjectCardStatus(project))}</div></div>
    ${visible.map((phaseKey) => phaseSection(project, phaseKey, false, nextUpId)).join("")}
    ${
      state.actor === "is"
        ? `<section class="tp-phase-section tp-phase-context"><header class="tp-phase-header"><div><div class="tp-phase-title">Read-only Context</div><p class="tp-phase-meta">Setup and Hypercare remain visible for handoff context.</p></div></header>${context.map((phaseKey) => phaseSection(project, phaseKey, true)).join("")}</section>`
        : ""
    }
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
  if (step === 0) return `<label class="tp-field"><span>Client Name</span><input type="text" value="${esc(d.clientName)}" data-bind="onboarding.clientName"></label><label class="tp-field"><span>Project Type</span><select data-bind="onboarding.projectType">${Object.entries(PROJECT_TYPE_META).map(([v, l]) => `<option value="${v}"${d.projectType === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  if (step === 1) return `<label class="tp-field"><span>PM Name</span><input type="text" value="${esc(d.pmName)}" data-bind="onboarding.pmName"></label><label class="tp-field"><span>PM Email</span><input type="email" value="${esc(d.pmEmail)}" data-bind="onboarding.pmEmail"></label><label class="tp-field"><span>IS Search / Email</span><input type="text" value="${esc(state.ui.peopleQuery)}" data-bind="peopleQuery"></label><div class="tp-quick-row"><button class="btn-default btn-sm" data-action="searchPeople">Search M365</button><span class="tp-muted">People.Read may prompt for re-consent.</span></div>${state.ui.peopleMatches.length ? `<div class="tp-people-list">${state.ui.peopleMatches.map((p) => `<button class="tp-people-pill" data-action="selectPerson" data-name="${esc(p.name)}" data-email="${esc(p.email)}">${esc(p.name || p.email)} <small>${esc(p.email)}</small></button>`).join("")}</div>` : ""}<label class="tp-field"><span>IS Name</span><input type="text" value="${esc(d.isName)}" data-bind="onboarding.isName"></label><label class="tp-field"><span>IS Email</span><input type="email" value="${esc(d.isEmail)}" data-bind="onboarding.isEmail"></label>`;
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
  return `<div class="tp-summary-card"><h4>${esc(d.clientName || "New Project")}</h4><p>${esc(PROJECT_TYPE_META[d.projectType])} | ${esc(d.pmName || d.pmEmail)} -> ${esc(d.isName || d.isEmail)}</p><p>Implementation window: ${esc(fmtRange(d.implementationStart, d.goLiveDate))}</p><p>Smart Fill default: ${esc(smartPreferenceLabel(d.smartFillPreference))}</p><p>${getAllSessions(d).length} sessions will be written to the sentinel.</p></div><details class="tp-template-review"><summary>Template JSON</summary><pre>${esc(state.ui.onboarding.templateReviewJSON)}</pre></details>`;
}

function onboardingModal() {
  if (!state.ui.onboarding.open) return "";
  const labels = ["Client", "Team", "Timeline", "Invitees", "Location", "Sessions", "Confirm"];
  return `<div class="tp-modal-overlay is-open"><div class="tp-modal tp-modal-wide"><div class="tp-modal-head"><div><h3>New Project</h3><p>${labels[Math.min(state.ui.onboarding.step, labels.length - 1)]}</p></div><button class="btn-default btn-sm" data-action="closeOnboarding">Close</button></div><div class="tp-stepper">${labels.map((l, i) => `<span class="tp-step${i === state.ui.onboarding.step ? " is-active" : ""}${i < state.ui.onboarding.step ? " is-done" : ""}">${esc(l)}</span>`).join("")}</div><div class="tp-modal-body">${onboardingStep()}</div><div class="tp-modal-actions"><button class="btn-default" data-action="prevOnboarding" ${state.ui.onboarding.step === 0 ? "disabled" : ""}>Back</button>${state.ui.onboarding.step >= 6 ? '<button class="btn-amber" data-action="createProject">Create Project</button>' : '<button class="btn-amber" data-action="nextOnboarding">Next</button>'}</div></div></div>`;
}

function settingsModal() {
  const d = state.ui.settings.draft;
  if (!state.ui.settings.open || !d) return "";
  return `<div class="tp-modal-overlay is-open"><div class="tp-modal tp-modal-wide"><div class="tp-modal-head"><div><h3>Project Settings</h3><p>Edit metadata and sessions.</p></div><button class="btn-default btn-sm" data-action="closeSettings">Close</button></div><div class="tp-settings-grid"><label class="tp-field"><span>Client</span><input type="text" value="${esc(d.clientName)}" data-bind="settings.clientName"></label><label class="tp-field"><span>Type</span><select data-bind="settings.projectType">${Object.entries(PROJECT_TYPE_META).map(([v, l]) => `<option value="${v}"${d.projectType === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label><label class="tp-field"><span>PM Name</span><input type="text" value="${esc(d.pmName)}" data-bind="settings.pmName"></label><label class="tp-field"><span>PM Email</span><input type="email" value="${esc(d.pmEmail)}" data-bind="settings.pmEmail"></label><label class="tp-field"><span>IS Name</span><input type="text" value="${esc(d.isName)}" data-bind="settings.isName"></label><label class="tp-field"><span>IS Email</span><input type="email" value="${esc(d.isEmail)}" data-bind="settings.isEmail"></label><label class="tp-field"><span>Kick-Off Date</span><input class="tp-mono" type="date" value="${d.projectStart}" data-bind="settings.projectStart"></label><label class="tp-field"><span>Implementation Start</span><input class="tp-mono" type="date" value="${d.implementationStart}" data-bind="settings.implementationStart"></label><label class="tp-field"><span>Go-Live</span><input class="tp-mono" type="date" value="${d.goLiveDate}" data-bind="settings.goLiveDate"></label><label class="tp-field"><span>Hypercare</span><select data-bind="settings.hypercareDuration"><option value="1 week"${d.hypercareDuration === "1 week" ? " selected" : ""}>1 week</option><option value="2 weeks"${d.hypercareDuration === "2 weeks" ? " selected" : ""}>2 weeks</option></select></label><label class="tp-field"><span>Smart Fill Default</span><select data-bind="settings.smartFillPreference"><option value="am"${d.smartFillPreference === "am" ? " selected" : ""}>AM</option><option value="none"${d.smartFillPreference === "none" ? " selected" : ""}>No Preference</option><option value="pm"${d.smartFillPreference === "pm" ? " selected" : ""}>PM</option></select></label><div class="tp-field tp-field-full"><span>Working Days</span>${renderWorkingDaysChips(d.workingDays, "Settings")}</div><div class="tp-summary-card tp-field-full"><p><strong>Suggested Go-Live:</strong> ${esc(fmtDate(d.goLiveSuggestedDate || d.goLiveDate || ""))}</p><p><strong>Recommended Duration:</strong> ${esc(fmtPhaseSpan(d.goLiveRecommendedWeeks))}</p>${d.goLiveWarning ? `<p class="tp-warning-copy">${esc(d.goLiveWarning)}</p>` : '<p class="tp-muted">Suggestion updates when implementation start or working days change.</p>'}</div><label class="tp-field tp-field-full"><span>Invitees</span><textarea rows="3" data-bind="settings.invitees">${esc(Array.isArray(d.invitees) ? d.invitees.join(", ") : d.invitees)}</textarea></label><label class="tp-field tp-field-full"><span>Location</span><input type="text" value="${esc(d.location)}" data-bind="settings.location"></label></div><div class="tp-settings-list">${PHASE_ORDER.map((phaseKey) => renderSessionRowsForStages(d, phaseKey, "moveSettingsSession", "removeSettingsSession")).join("")}</div><div class="tp-builder-grid"><label class="tp-field tp-field-compact"><span>Name</span><input type="text" value="${esc(d.newSession?.name || "")}" data-bind="settings.newSession.name"></label><label class="tp-field tp-field-compact"><span>Duration</span><input class="tp-mono" type="number" min="15" step="15" value="${d.newSession?.duration || 90}" data-bind="settings.newSession.duration"></label><label class="tp-field tp-field-compact"><span>Phase</span><select data-bind="settings.newSession.phase">${PHASE_ORDER.map((p) => `<option value="${p}"${d.newSession?.phase === p ? " selected" : ""}>${esc(PHASE_META[p].label)}</option>`).join("")}</select></label><label class="tp-field tp-field-compact"><span>Stage</span><select data-bind="settings.newSession.stageKey">${renderStageOptions(d, d.newSession?.phase || "implementation", d.newSession?.stageKey || "")}</select></label>${d.newSession?.stageKey === "__new__" || !getPhaseStages(d, d.newSession?.phase || "implementation").length ? `<label class="tp-field tp-field-compact"><span>New Stage Label</span><input type="text" value="${esc(d.newSession?.newStageLabel || "")}" data-bind="settings.newSession.newStageLabel"></label>` : ""}<label class="tp-field tp-field-compact"><span>Owner</span><select data-bind="settings.newSession.owner"><option value="pm"${d.newSession?.owner === "pm" ? " selected" : ""}>PM</option><option value="is"${d.newSession?.owner === "is" ? " selected" : ""}>IS</option></select></label><label class="tp-field tp-field-compact"><span>Type</span><select data-bind="settings.newSession.type"><option value="external"${d.newSession?.type === "external" ? " selected" : ""}>External</option><option value="internal"${d.newSession?.type === "internal" ? " selected" : ""}>Internal</option></select></label><button class="btn-amber" data-action="addSettingsSession">Add Session</button></div><div class="tp-modal-actions"><button class="btn-default" data-action="closeSettings">Cancel</button><button class="btn-amber" data-action="saveSettings">Save Project</button></div></div></div>`;
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

export function render() {
  const app = document.getElementById("app");
  if (!app) return;
  const project = getActiveProject();
  const main = state.ui.screen === "auth" ? authScreen() : state.ui.screen === "workspace" && project ? workspace(project) : projectsScreen();
  app.innerHTML = `${state.ui.screen === "auth" ? "" : topbar()}${main}${onboardingModal()}${settingsModal()}${windowChangeDialog()}${shiftDialog()}${deleteProjectDialog()}${closeProjectDialog()}${projectErrorModal()}${renderDayViewModal()}<div class="tp-toast" id="toast"></div>`;
}
