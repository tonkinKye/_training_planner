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

function renderWorkingDaysChips(days, scope) {
  const selected = new Set(days || []);
  return `<div class="day-row">
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
          `<button class="day-chip${selected.has(day) ? " active" : ""}" data-action="toggle${scope}WorkingDay" data-day="${day}">${label}</button>`
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
      return `<div class="settings-phase">
        <h4>${esc(stage.label)}</h4>
        ${sessions
          .map(
            (session) => `<div class="settings-row"><div><strong>${esc(session.name)}</strong><small>${fmtDur(
              session.duration
            )} | ${session.owner === "is" ? "IS" : "PM"} | ${esc(session.type)}</small></div><div class="quick-row">${session.lockedDate ? '<span class="tag muted">System Managed</span>' : `<button class="btn-secondary btn-sm" data-action="${moveAction}" data-id="${session.id}" data-dir="-1">Up</button><button class="btn-secondary btn-sm" data-action="${moveAction}" data-id="${session.id}" data-dir="1">Down</button><button class="btn-danger-outline btn-sm" data-action="${removeAction}" data-id="${session.id}">Remove</button>`}</div></div>`
          )
          .join("")}
      </div>`;
    })
    .join("");
}

function renderSmartPreferenceToggle(selectedValue, actionName = "setSmartPreference") {
  return `<div class="smart-toggle" role="group" aria-label="Smart Fill preference">
    ${[
      ["am", "AM"],
      ["none", "No Preference"],
      ["pm", "PM"],
    ]
      .map(
        ([value, label]) =>
          `<button class="smart-toggle-btn${selectedValue === value ? " active" : ""}" data-action="${actionName}" data-value="${value}">${label}</button>`
      )
      .join("")}
  </div>`;
}

function topbar() {
  const name = state.graphAccount?.name || state.graphAccount?.username || "Microsoft 365";
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark">TP</span><div><strong>Training Planner</strong><small>${state.actor === "is" ? "IS View" : "PM View"}</small></div></div>
    <div class="topbar-actions">
      ${state.ui.screen === "workspace" && state.actor === "pm" ? '<button class="btn-secondary" data-action="backToProjects">Projects</button>' : ""}
      <button class="btn-secondary" data-action="toggleAuth">${esc(name)} | Sign Out</button>
    </div>
  </header>`;
}

function authScreen() {
  return `<main class="screen auth-screen">
    <section class="auth-card">
      <div class="auth-mark">TP</div>
      <div class="auth-copy">
        <div class="eyebrow">Training Planner</div>
        <h1>Login to proceed</h1>
        <p>Sign in with your work or school Microsoft 365 account to open projects and continue scheduling.</p>
      </div>
      <div class="auth-actions">
        <button class="btn-primary btn-lg auth-button" data-action="toggleAuth">Sign In With Microsoft 365</button>
        <div class="auth-note">Work / School M365 only</div>
      </div>
      ${state.authError ? `<div class="inline-alert danger">${esc(state.authError)}</div>` : ""}
    </section>
  </main>`;
}

function getProjectKanbanColumn(project) {
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
  return `<button class="kanban-card${archived ? " archived" : ""}" data-action="selectProject" data-id="${project.id}">
    <div class="kanban-card-head"><strong>${esc(project.clientName || "Untitled")}</strong>${canDelete ? `<span class="card-delete" data-action="deleteProject" data-id="${project.id}" data-name="${esc(project.clientName || "Untitled")}" title="Delete">&times;</span>` : ""}</div>
    <span class="kanban-next">${esc(nextLabel)}</span>
    <div class="kanban-progress"><div class="kanban-bar" style="width:${progress.percent}%"></div></div>
    <span class="kanban-meta">${progress.total ? `${progress.percent}% impl` : ""}${progress.total && countdown ? " \u00B7 " : ""}${esc(countdown)}</span>
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

  const searchBar = `<div class="projects-toolbar">
    <input type="text" class="project-search" placeholder="Search projects..." value="${esc(state.ui.projectSearch)}" data-action="projectSearch">
    <label class="toggle-label"><input type="checkbox" ${state.ui.showArchived ? "checked" : ""} data-action="toggleArchived"> Show archived (${archivedCount})</label>
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
      return `<div class="kanban-column">
        <div class="kanban-col-header phase-${col.phase}"><span>${esc(col.label)}</span>${cards.length ? `<span class="kanban-count">${cards.length}</span>` : ""}</div>
        ${cards.map((p) => kanbanCard(p, ARCHIVE_STATUSES.has(p.status))).join("")}
      </div>`;
    }).join("");

    groupsHTML += `<section class="is-group">
      <header class="is-group-header"><h2>${esc(isName)}</h2><span class="muted">${projects.length} project${projects.length !== 1 ? "s" : ""}</span></header>
      <div class="kanban-board">${boardHTML}</div>
    </section>`;
  }

  const emptyState = visible.length
    ? ""
    : state.projects.length
      ? `<section class="empty-card"><h2>No matches</h2><p>No projects match "${esc(search)}"${!state.ui.showArchived && archivedCount ? ". Try showing archived projects." : ""}.</p></section>`
      : `<section class="empty-card"><h2>No projects yet</h2><p>Create a project to seed the sentinel and open the scheduler.</p><button class="btn-primary" data-action="openOnboarding">Create Project</button></section>`;

  return `<main class="screen projects-screen">
    <section class="screen-head">
      <div>
        <div class="eyebrow">Sentinel-backed Project Index</div>
        <h1>Projects</h1>
      </div>
      <button class="btn-primary" data-action="openOnboarding">New Project</button>
    </section>
    ${state.sentinel.malformed ? `<section class="inline-alert danger split"><div><strong>Could not load projects.</strong><div>${esc(state.sentinel.error || "Malformed sentinel payload.")}</div></div><button class="btn-danger-outline" data-action="resetSentinel">Reset Sentinel</button></section>` : ""}
    ${state.projects.length ? searchBar : ""}
    ${groupsHTML}
    ${emptyState}
  </main>`;
}

function conflictButton(project) {
  const summary = getConflictSummary({ project, actor: state.actor, scope: "review", blockingOnly: true });
  return summary.sessions
    ? `<button class="btn-secondary" data-action="reviewConflicts">Review Conflicts (${summary.sessions})</button>`
    : '<button class="btn-secondary" data-action="checkConflicts">Check Conflicts</button>';
}

function renderConflictTags(conflicts) {
  const summary = summarizeConflictKinds(conflicts);
  return [
    summary.hasWindow ? `<span class="tag warning">${summary.windowLabel}</span>` : "",
    summary.hasCalendar ? `<span class="tag danger">${summary.calendarLabel}</span>` : "",
    summary.hasAvailability ? `<span class="tag info">${summary.availabilityLabel}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
}

function sidebar(project) {
  const range = getProjectDateRange(project);
  const availability = getSmartAvailabilityState(project, state.actor);
  const availabilityMessage =
    state.calendarAvailability.status === "loading"
      ? "Refreshing availability for this project window..."
      : availability.ready
        ? "Availability loaded for this project window"
        : "No availability loaded; Smart Fill will assign dates only";
  return `<aside class="sidebar">
    <section class="side-card">
      <div class="card-top">
        <span class="pill type">${esc(PROJECT_TYPE_META[project.projectType])}</span>
        <span class="pill status">${esc(getProjectCardStatus(project))}</span>
      </div>
      <h2>${esc(project.clientName)}</h2>
      <dl class="meta-list">
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
          ? `<div class="side-note"><strong>Latest handoff</strong><div>${state.ui.lastHandoff.length} chars</div><button class="btn-secondary btn-sm" data-action="copyHandoffLink">Copy Link</button></div>`
          : ""
      }
    </section>
    <section class="side-card">
      <div class="side-head"><h3>Smart Fill</h3><button class="btn-secondary btn-sm" data-action="toggleSmart">${state.ui.smartOpen ? "Hide" : "Show"}</button></div>
      ${
        state.ui.smartOpen
          ? `<label class="field"><span>Schedule from</span><input type="date" value="${state.ui.smartStart}" data-action="setSmartStart"><small class="muted">Sessions won't be placed before this date. Internal prep sessions may use earlier dates.</small></label>
             <div class="field"><span>Days</span><div class="day-row">
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
                     `<button class="day-chip${state.ui.activeDays.has(day) ? " active" : ""}" data-action="toggleActiveDay" data-day="${day}">${label}</button>`
                 )
                 .join("")}
             </div></div>
             <div class="field"><span>Preferred half-day</span>${renderSmartPreferenceToggle(state.ui.smartPreference)}</div>
             <div class="quick-row">
               <button class="btn-secondary btn-sm" data-action="setDayPreset" data-days="1,2,3,4,5">Weekdays</button>
               <button class="btn-secondary btn-sm" data-action="setDayPreset" data-days="1,3,5">M/W/F</button>
               <button class="btn-secondary btn-sm" data-action="setDayPreset" data-days="2,4">T/Th</button>
             </div>
             <div class="quick-row">
               <button class="btn-secondary" data-action="refreshSmartAvailability">Refresh Availability</button>
               <button class="btn-primary" data-action="applySmartFill">Apply Smart Fill</button>
               <button class="btn-danger-outline btn-sm" data-action="clearSmartFill">Clear Schedule</button>
             </div>
             <p class="muted smart-status${availability.ready ? " ready" : ""}">${availabilityMessage}</p>`
          : '<p class="muted">Phase-aware Smart Fill respects setup, implementation, and hypercare windows.</p>'
      }
    </section>
  </aside>`;
}

function sessionBadges(project, session, context) {
  const scope = editableConflictScope(project, session, context);
  const conflicts = getSessionConflicts(session.id, { project, actor: state.actor, scope });
  return [
    `<span class="tag">${session.owner === "is" ? "IS" : "PM"}</span>`,
    `<span class="tag">${esc(PHASE_META[session.phase].label)}</span>`,
    `<span class="tag">${session.type === "internal" ? "Internal" : "External"}</span>`,
    context ? '<span class="tag muted">Context</span>' : "",
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
  const past = session.date && session.date < today ? " past" : "";
  const editable = canEditSession(project, session, state.actor) && !context;
  const durationDisabled = editable && state.actor === "pm" ? "" : "disabled";
  const dateDisabled = editable && !session.lockedDate ? "" : "disabled";
  const timeDisabled = editable && !session.lockedTime ? "" : "disabled";
  return `<article class="session-row phase-${session.phase}${context ? " context" : ""}${past}${isNextUp ? " next-up" : ""}">
    <div class="session-bar"></div>
    <div class="session-body">
      <div class="session-head">
        <div><h4>${esc(session.name)}</h4><div class="tag-row">${sessionBadges(project, session, context)}${isNextUp ? '<span class="tag info">Next</span>' : ""}</div></div>
        <div class="row-actions">
          <button class="btn-secondary btn-sm" data-action="openDayView" data-date="${session.date || project.implementationStart || project.goLiveDate || toDateStr(new Date())}">Week</button>
          ${editable && session.date && !session.lockedDate ? `<button class="btn-secondary btn-sm" data-action="unscheduleSession" data-id="${session.id}">Unschedule</button>` : ""}
          ${canCommitSession(session, state.actor) && session.date && session.time ? `<button class="btn-secondary btn-sm" data-action="pushSession" data-id="${session.id}">${session.graphActioned ? "Update" : "Push"}</button>` : ""}
          ${session.type === "external" && session.date && session.time ? `<button class="btn-secondary btn-sm" data-action="openOutlook" data-id="${session.id}">Outlook</button>` : ""}
          ${state.actor === "pm" && editable ? `<button class="btn-secondary btn-sm" data-action="moveSession" data-id="${session.id}" data-dir="-1">Up</button><button class="btn-secondary btn-sm" data-action="moveSession" data-id="${session.id}" data-dir="1">Down</button><button class="btn-danger-outline btn-sm" data-action="removeSession" data-id="${session.id}">Remove</button>` : ""}
        </div>
      </div>
      <div class="field-row">
        <label class="field compact"><span>Date</span><input type="date" value="${session.date || ""}" ${dateDisabled} data-action="setSessionDate" data-id="${session.id}"></label>
        <label class="field compact"><span>Time</span><select ${timeDisabled} data-action="setSessionTime" data-id="${session.id}">${getTimeOptionsHTML(session.time || "")}</select></label>
        <label class="field compact"><span>Duration</span><select ${durationDisabled} data-action="setSessionDuration" data-id="${session.id}">${DURATION_OPTIONS.map((m) => `<option value="${m}"${m === session.duration ? " selected" : ""}>${fmtDur(m)}</option>`).join("")}</select></label>
      </div>
    </div>
  </article>`;
}

function phaseSection(project, phaseKey, context = false, nextUpId = "") {
  const stages = getPhaseStages(project, phaseKey).filter((stage) => (stage.sessions || []).length);
  if (!stages.length) return "";
  const summary = getPhaseSummary(project, phaseKey);
  const owner = getActorDisplayName(project, PHASE_META[phaseKey].owner);
  const suggested = fmtWeekRange(summary.suggestedWeeksMin, summary.suggestedWeeksMax);
  return `<section class="phase-group phase-${phaseKey}${context ? " context" : ""}">
    <header class="phase-head">
      <div><h3>${esc(PHASE_META[phaseKey].label)}</h3><p>${esc(owner)} | ${summary.scheduled} / ${summary.total} scheduled</p></div>
      <div class="phase-range"><strong>${esc(fmtPhaseSpan(summary.spanWeeks))}</strong>${suggested ? ` <span>${esc(suggested)}</span>` : ""}${summary.exceedsSuggestedMax ? ' <span class="tag warning">Over suggested</span>' : ""}</div>
    </header>
    <div class="phase-list">${stages
      .map(
        (stage) => `<section class="stage-group"><header class="stage-head"><h4>${esc(stage.label)}</h4>${stage.rangeStart || stage.rangeEnd ? `<span class="stage-range">${esc(fmtRange(stage.rangeStart, stage.rangeEnd))}</span>` : ""}</header>${stage.sessions
          .map((session) => sessionRow(project, session, context, !context && session.id === nextUpId))
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
  return `<section class="panel schedule-panel${state.ui.mobileTab === "calendar" ? " mobile-hidden" : ""}">
    <div class="panel-head"><div><h2>${esc(project.clientName)}</h2><p>${esc(PROJECT_TYPE_META[project.projectType])} | ${esc(getProjectCardStatus(project))}</p></div><button class="btn-secondary btn-sm mobile-only" data-action="switchMobileTab" data-tab="calendar">Calendar</button></div>
    ${visible.map((phaseKey) => phaseSection(project, phaseKey, false, nextUpId)).join("")}
    ${
      state.actor === "is"
        ? `<section class="phase-group read-only-context"><header class="phase-head"><div><h3>Read-only Context</h3><p>Setup and Hypercare remain visible for handoff context.</p></div></header>${context.map((phaseKey) => phaseSection(project, phaseKey, true)).join("")}</section>`
        : ""
    }
  </section>`;
}

function calendarPanel(project) {
  if (!state.calStart) {
    const range = getProjectDateRange(project);
    state.calStart = mondayOf(parseDate(range.start || toDateStr(new Date())));
  }
  const mobile = window.innerWidth <= 860;
  const cols = mobile ? 5 : 7;
  const weeks = 6;
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
      hasWindowConflict: dayConflictKinds.hasWindow,
      hasCalendarConflict: dayConflictKinds.hasCalendar,
      hasAvailabilityConflict: dayConflictKinds.hasAvailability,
    });
  }
  return `<section class="panel calendar-panel${state.ui.mobileTab === "schedule" ? " mobile-hidden" : ""}">
    <div class="panel-head"><div><h2>Calendar</h2><p>${conflictSummary.sessions ? `${conflictSummary.sessions} sessions need review${conflictSummary.label ? ` | ${esc(conflictSummary.label)}` : ""}` : "Drop sessions onto a day or open week view."}</p></div><button class="btn-secondary btn-sm mobile-only" data-action="switchMobileTab" data-tab="schedule">Schedule</button></div>
    <div class="unscheduled-strip"><strong>Unscheduled</strong><div class="unscheduled-list">${unscheduled.length ? unscheduled.map((s) => `<div class="unscheduled-chip phase-${s.phase}" draggable="true" data-drag="session" data-id="${s.id}">${esc(s.name)} <small>${fmtDur(s.duration)}</small></div>`).join("") : '<span class="muted">All editable sessions are scheduled.</span>'}</div></div>
    <div class="calendar-nav"><button class="btn-secondary btn-sm" data-action="calShift" data-dir="-1">Prev</button><button class="btn-secondary btn-sm" data-action="calToday">Today</button><button class="btn-secondary btn-sm" data-action="calShift" data-dir="1">Next</button></div>
    <div class="calendar-scroll"><div class="calendar-grid" style="grid-template-columns:32px repeat(${cols},1fr);"><div class="week-spacer"></div>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].slice(0, cols).map((d) => `<div class="cal-head">${d}</div>`).join("")}${Array.from({ length: weeks }).map((_, week) => `<div class="week-label">W${week + 1}</div>${cells.slice(week * cols, week * cols + cols).map((cell) => `<div class="cal-cell${cell.today ? " today" : ""}${cell.hasCalendarConflict ? " has-conflict" : ""}${cell.hasWindowConflict ? " has-window-conflict" : ""}${cell.hasAvailabilityConflict ? " has-availability-conflict" : ""}" data-drop data-date="${cell.dateString}"><button class="cal-date" data-action="openDayView" data-date="${cell.dateString}">${cell.date.getDate()}</button><div class="cal-events">${cell.sessions.map((s) => `<div class="cal-chip phase-${s.phase}${canEditSession(project, s, state.actor) ? "" : " context"}${!s.time && s.availabilityConflict === true ? " needs-time" : ""}${s.date && s.date < toDateStr(new Date()) ? " past" : ""}" ${canEditSession(project, s, state.actor) && !s.lockedDate ? `draggable="true" data-drag="session" data-id="${s.id}"` : ""}><span>${esc(s.name)}</span><small>${esc(fmtTimeLabel(s.time))}</small></div>`).join("")}</div></div>`).join("")}`).join("")}</div></div>
  </section>`;
}

function workspace(project) {
  const projectStatus = deriveProjectStatus(project);
  const closedBanner = project.closedAt
    ? `<div class="closed-banner inline-alert danger"><strong>Project Closed</strong> by ${esc(project.closedBy || "PM")} on ${esc(fmtDate(project.closedAt))}${state.actor === "is" ? ' <button class="btn-secondary btn-sm" data-action="cleanUpCalendar">Clean Up Calendar</button>' : ""}</div>`
    : "";
  const canClose = state.actor === "pm" && !["scheduling", "complete", "closed"].includes(projectStatus);
  const toolbar = project.closedAt
    ? ""
    : `<div class="workspace-toolbar">
      <div class="toolbar-group">${conflictButton(project)}<button class="btn-primary" data-action="pushOwned">${state.actor === "is" ? "Commit to Calendar" : "Push All"}</button>${state.actor === "pm" && readyForHandoff(project) ? '<button class="btn-amber" data-action="handoffToIs">Hand Off to IS</button>' : ""}</div>
      <div class="toolbar-group"><button class="btn-secondary" data-action="toggleSmart">${state.ui.smartOpen ? "Hide Smart Fill" : "Smart Fill"}</button>${state.actor === "pm" ? '<button class="btn-secondary" data-action="generateClientPlan">Client Plan</button>' : ""}<button class="btn-secondary" data-action="openSettings">Project Settings</button>${canClose ? `<button class="btn-danger-outline btn-sm" data-action="closeProject" data-id="${project.id}" data-name="${esc(project.clientName || "Untitled Project")}">Close Project</button>` : ""}${state.actor === "pm" && projectStatus === "scheduling" ? `<button class="btn-danger-outline btn-sm" data-action="deleteProject" data-id="${project.id}" data-name="${esc(project.clientName || "Untitled Project")}">Delete</button>` : ""}</div>
    </div>`;
  return `<main class="screen workspace-screen">
    ${closedBanner}
    ${toolbar}
    <div class="mobile-tabs"><button class="mobile-tab${state.ui.mobileTab === "schedule" ? " active" : ""}" data-action="switchMobileTab" data-tab="schedule">Schedule</button><button class="mobile-tab${state.ui.mobileTab === "calendar" ? " active" : ""}" data-action="switchMobileTab" data-tab="calendar">Calendar</button></div>
    <div class="workspace-grid">${sidebar(project)}${sessionPanel(project)}${calendarPanel(project)}</div>
  </main>`;
}

function onboardingStep() {
  const d = state.ui.onboarding.draft;
  if (!d) return "";
  const step = state.ui.onboarding.step;
  if (step === 0) return `<label class="field"><span>Client Name</span><input type="text" value="${esc(d.clientName)}" data-bind="onboarding.clientName"></label><label class="field"><span>Project Type</span><select data-bind="onboarding.projectType">${Object.entries(PROJECT_TYPE_META).map(([v, l]) => `<option value="${v}"${d.projectType === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  if (step === 1) return `<label class="field"><span>PM Name</span><input type="text" value="${esc(d.pmName)}" data-bind="onboarding.pmName"></label><label class="field"><span>PM Email</span><input type="email" value="${esc(d.pmEmail)}" data-bind="onboarding.pmEmail"></label><label class="field"><span>IS Search / Email</span><input type="text" value="${esc(state.ui.peopleQuery)}" data-bind="peopleQuery"></label><div class="quick-row"><button class="btn-secondary btn-sm" data-action="searchPeople">Search M365</button><span class="muted">People.Read may prompt for re-consent.</span></div>${state.ui.peopleMatches.length ? `<div class="people-list">${state.ui.peopleMatches.map((p) => `<button class="people-pill" data-action="selectPerson" data-name="${esc(p.name)}" data-email="${esc(p.email)}">${esc(p.name || p.email)} <small>${esc(p.email)}</small></button>`).join("")}</div>` : ""}<label class="field"><span>IS Name</span><input type="text" value="${esc(d.isName)}" data-bind="onboarding.isName"></label><label class="field"><span>IS Email</span><input type="email" value="${esc(d.isEmail)}" data-bind="onboarding.isEmail"></label>`;
  if (step === 2) {
    const tl = getTimelineSuggestion(d);
    const fmtWk = (min, max) => min && max && min !== max ? `${min}\u2013${max} weeks` : `${min || max || "?"} week${(min || max) === 1 ? "" : "s"}`;
    const goLiveEarlierThanRec = d.goLiveDate && tl.earliestGoLive && d.goLiveDate < tl.earliestGoLive;
    const kickOffLabel = d.projectStart ? fmtDate(d.projectStart) : "";
    const contextLine = kickOffLabel && tl.setupMin && tl.implMin ? `Based on ${esc(kickOffLabel)} kick-off \u00B7 ${tl.setupMin} wk setup \u00B7 ${Math.max(tl.implMin, tl.implFloor)} wk implementation` : "";
    return `<div class="settings-grid">
      <label class="field"><span>Kick-Off Date</span><input type="date" value="${d.projectStart}" data-bind="onboarding.projectStart"></label>
      <label class="field"><span>Go-Live Date</span><input type="date" value="${d.goLiveDate}" data-bind="onboarding.goLiveDate">${tl.earliestGoLive ? `<small class="muted">Earliest recommended: ${esc(fmtDate(tl.earliestGoLive))}</small>` : ""}${goLiveEarlierThanRec ? `<small class="warning-copy">This is earlier than the recommended minimum. The timeline may be too tight for this template.</small>` : ""}</label>
      <label class="field"><span>Hypercare</span><select data-bind="onboarding.hypercareDuration"><option value="1 week"${d.hypercareDuration === "1 week" ? " selected" : ""}>1 week</option><option value="2 weeks"${d.hypercareDuration === "2 weeks" ? " selected" : ""}>2 weeks</option></select></label>
      <label class="field"><span>Smart Fill Default</span><select data-bind="onboarding.smartFillPreference"><option value="am"${d.smartFillPreference === "am" ? " selected" : ""}>AM</option><option value="none"${d.smartFillPreference === "none" ? " selected" : ""}>No Preference</option><option value="pm"${d.smartFillPreference === "pm" ? " selected" : ""}>PM</option></select></label>
      <div class="field full"><span>Working Days</span>${renderWorkingDaysChips(d.workingDays, "Onboarding")}</div>
      <div class="summary-card full">
        <div class="timeline-breakdown">
          <div class="tl-row"><span>Setup</span><strong>${tl.setupMin != null ? esc(fmtWk(tl.setupMin, tl.setupMax)) : "N/A"}</strong></div>
          <div class="tl-row"><span>Implementation</span><strong>${tl.implMin != null ? esc(fmtWk(tl.implMin, tl.implMax)) : "N/A"}</strong></div>
          <div class="tl-row"><span>Hypercare</span><strong>${tl.hcMin != null ? esc(fmtWk(tl.hcMin, tl.hcMax)) : "N/A"}</strong></div>
          <div class="tl-divider"></div>
          <div class="tl-row tl-total"><span>Total from Kick-Off</span><strong>${tl.totalMin ? esc(fmtWk(tl.totalMin, tl.totalMax)) : "N/A"}</strong></div>
          ${tl.earliestGoLive ? `<div class="tl-row"><span>Earliest Go-Live</span><strong>${esc(fmtDate(tl.earliestGoLive))}</strong></div>` : ""}
          ${tl.earliestWrapUp ? `<div class="tl-row"><span>Earliest wrap-up</span><strong>${esc(fmtDate(tl.earliestWrapUp))}</strong></div>` : ""}
        </div>
        ${tl.implFloorExceedsMin ? `<p class="warning-copy">Minimum ${tl.implFloor} implementation weeks required at 3 sessions/week — exceeds the template suggestion of ${tl.implMin}.</p>` : ""}
        ${contextLine ? `<p class="muted">${contextLine}</p>` : ""}
      </div>
      <p class="muted full">Internal sessions (Sales Handover, Installation) will be placed before the Kick-Off Date where possible.</p>
    </div>`;
  }
  if (step === 3) return `<label class="field full"><span>Invitees</span><textarea rows="5" data-bind="onboarding.invitees">${esc(Array.isArray(d.invitees) ? d.invitees.join(", ") : d.invitees)}</textarea><small class="muted">Use commas or new lines to separate attendee email addresses.</small></label>`;
  if (step === 4) return `<label class="field"><span>Location</span><input type="text" value="${esc(d.location)}" data-bind="onboarding.location"><small class="muted">Enter a room name or Teams URL.</small></label>`;
  if (step === 5) return `<div class="settings-session-list">${PHASE_ORDER.map((phaseKey) => renderSessionRowsForStages(d, phaseKey, "moveOnboardingSession", "removeOnboardingSession")).join("")}</div><div class="builder-grid"><label class="field compact"><span>Name</span><input type="text" value="${esc(d.customSession.name)}" data-bind="onboarding.customSession.name"></label><label class="field compact"><span>Duration</span><input type="number" min="15" step="15" value="${d.customSession.duration}" data-bind="onboarding.customSession.duration"></label><label class="field compact"><span>Phase</span><select data-bind="onboarding.customSession.phase">${PHASE_ORDER.map((p) => `<option value="${p}"${d.customSession.phase === p ? " selected" : ""}>${esc(PHASE_META[p].label)}</option>`).join("")}</select></label><label class="field compact"><span>Stage</span><select data-bind="onboarding.customSession.stageKey">${renderStageOptions(d, d.customSession.phase, d.customSession.stageKey)}</select></label>${d.customSession.stageKey === "__new__" || !getPhaseStages(d, d.customSession.phase).length ? `<label class="field compact"><span>New Stage Label</span><input type="text" value="${esc(d.customSession.newStageLabel)}" data-bind="onboarding.customSession.newStageLabel"></label>` : ""}<label class="field compact"><span>Owner</span><select data-bind="onboarding.customSession.owner"><option value="pm"${d.customSession.owner === "pm" ? " selected" : ""}>PM</option><option value="is"${d.customSession.owner === "is" ? " selected" : ""}>IS</option></select></label><label class="field compact"><span>Type</span><select data-bind="onboarding.customSession.type"><option value="external"${d.customSession.type === "external" ? " selected" : ""}>External</option><option value="internal"${d.customSession.type === "internal" ? " selected" : ""}>Internal</option></select></label><button class="btn-primary" data-action="addOnboardingSession">Add Session</button></div>`;
  return `<div class="summary-card"><h4>${esc(d.clientName || "New Project")}</h4><p>${esc(PROJECT_TYPE_META[d.projectType])} | ${esc(d.pmName || d.pmEmail)} -> ${esc(d.isName || d.isEmail)}</p><p>Implementation window: ${esc(fmtRange(d.implementationStart, d.goLiveDate))}</p><p>Smart Fill default: ${esc(smartPreferenceLabel(d.smartFillPreference))}</p><p>${getAllSessions(d).length} sessions will be written to the sentinel.</p></div><details class="template-review"><summary>Template JSON</summary><pre>${esc(state.ui.onboarding.templateReviewJSON)}</pre></details>`;
}

function onboardingModal() {
  if (!state.ui.onboarding.open) return "";
  const labels = ["Client", "Team", "Timeline", "Invitees", "Location", "Sessions", "Confirm"];
  return `<div class="modal-overlay open"><div class="modal wide"><div class="modal-head"><div><h3>New Project</h3><p>${labels[Math.min(state.ui.onboarding.step, labels.length - 1)]}</p></div><button class="btn-secondary btn-sm" data-action="closeOnboarding">Close</button></div><div class="steps">${labels.map((l, i) => `<span class="step${i === state.ui.onboarding.step ? " active" : ""}${i < state.ui.onboarding.step ? " done" : ""}">${esc(l)}</span>`).join("")}</div><div class="modal-body">${onboardingStep()}</div><div class="modal-actions"><button class="btn-secondary" data-action="prevOnboarding" ${state.ui.onboarding.step === 0 ? "disabled" : ""}>Back</button>${state.ui.onboarding.step >= 6 ? '<button class="btn-primary" data-action="createProject">Create Project</button>' : '<button class="btn-primary" data-action="nextOnboarding">Next</button>'}</div></div></div>`;
}

function settingsModal() {
  const d = state.ui.settings.draft;
  if (!state.ui.settings.open || !d) return "";
  return `<div class="modal-overlay open"><div class="modal wide"><div class="modal-head"><div><h3>Project Settings</h3><p>Edit metadata and sessions.</p></div><button class="btn-secondary btn-sm" data-action="closeSettings">Close</button></div><div class="settings-grid"><label class="field"><span>Client</span><input type="text" value="${esc(d.clientName)}" data-bind="settings.clientName"></label><label class="field"><span>Type</span><select data-bind="settings.projectType">${Object.entries(PROJECT_TYPE_META).map(([v, l]) => `<option value="${v}"${d.projectType === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label><label class="field"><span>PM Name</span><input type="text" value="${esc(d.pmName)}" data-bind="settings.pmName"></label><label class="field"><span>PM Email</span><input type="email" value="${esc(d.pmEmail)}" data-bind="settings.pmEmail"></label><label class="field"><span>IS Name</span><input type="text" value="${esc(d.isName)}" data-bind="settings.isName"></label><label class="field"><span>IS Email</span><input type="email" value="${esc(d.isEmail)}" data-bind="settings.isEmail"></label><label class="field"><span>Kick-Off Date</span><input type="date" value="${d.projectStart}" data-bind="settings.projectStart"></label><label class="field"><span>Implementation Start</span><input type="date" value="${d.implementationStart}" data-bind="settings.implementationStart"></label><label class="field"><span>Go-Live</span><input type="date" value="${d.goLiveDate}" data-bind="settings.goLiveDate"></label><label class="field"><span>Hypercare</span><select data-bind="settings.hypercareDuration"><option value="1 week"${d.hypercareDuration === "1 week" ? " selected" : ""}>1 week</option><option value="2 weeks"${d.hypercareDuration === "2 weeks" ? " selected" : ""}>2 weeks</option></select></label><label class="field"><span>Smart Fill Default</span><select data-bind="settings.smartFillPreference"><option value="am"${d.smartFillPreference === "am" ? " selected" : ""}>AM</option><option value="none"${d.smartFillPreference === "none" ? " selected" : ""}>No Preference</option><option value="pm"${d.smartFillPreference === "pm" ? " selected" : ""}>PM</option></select></label><div class="field full"><span>Working Days</span>${renderWorkingDaysChips(d.workingDays, "Settings")}</div><div class="summary-card full"><p><strong>Suggested Go-Live:</strong> ${esc(fmtDate(d.goLiveSuggestedDate || d.goLiveDate || ""))}</p><p><strong>Recommended Duration:</strong> ${esc(fmtPhaseSpan(d.goLiveRecommendedWeeks))}</p>${d.goLiveWarning ? `<p class="warning-copy">${esc(d.goLiveWarning)}</p>` : '<p class="muted">Suggestion updates when implementation start or working days change.</p>'}</div><label class="field full"><span>Invitees</span><textarea rows="3" data-bind="settings.invitees">${esc(Array.isArray(d.invitees) ? d.invitees.join(", ") : d.invitees)}</textarea></label><label class="field full"><span>Location</span><input type="text" value="${esc(d.location)}" data-bind="settings.location"></label></div><div class="settings-session-list">${PHASE_ORDER.map((phaseKey) => renderSessionRowsForStages(d, phaseKey, "moveSettingsSession", "removeSettingsSession")).join("")}</div><div class="builder-grid"><label class="field compact"><span>Name</span><input type="text" value="${esc(d.newSession?.name || "")}" data-bind="settings.newSession.name"></label><label class="field compact"><span>Duration</span><input type="number" min="15" step="15" value="${d.newSession?.duration || 90}" data-bind="settings.newSession.duration"></label><label class="field compact"><span>Phase</span><select data-bind="settings.newSession.phase">${PHASE_ORDER.map((p) => `<option value="${p}"${d.newSession?.phase === p ? " selected" : ""}>${esc(PHASE_META[p].label)}</option>`).join("")}</select></label><label class="field compact"><span>Stage</span><select data-bind="settings.newSession.stageKey">${renderStageOptions(d, d.newSession?.phase || "implementation", d.newSession?.stageKey || "")}</select></label>${d.newSession?.stageKey === "__new__" || !getPhaseStages(d, d.newSession?.phase || "implementation").length ? `<label class="field compact"><span>New Stage Label</span><input type="text" value="${esc(d.newSession?.newStageLabel || "")}" data-bind="settings.newSession.newStageLabel"></label>` : ""}<label class="field compact"><span>Owner</span><select data-bind="settings.newSession.owner"><option value="pm"${d.newSession?.owner === "pm" ? " selected" : ""}>PM</option><option value="is"${d.newSession?.owner === "is" ? " selected" : ""}>IS</option></select></label><label class="field compact"><span>Type</span><select data-bind="settings.newSession.type"><option value="external"${d.newSession?.type === "external" ? " selected" : ""}>External</option><option value="internal"${d.newSession?.type === "internal" ? " selected" : ""}>Internal</option></select></label><button class="btn-primary" data-action="addSettingsSession">Add Session</button></div><div class="modal-actions"><button class="btn-secondary" data-action="closeSettings">Cancel</button><button class="btn-primary" data-action="saveSettings">Save Project</button></div></div></div>`;
}

function windowChangeDialog() {
  const dialog = state.ui.windowChangeDialog;
  if (!dialog.open) return "";
  return `<div class="modal-overlay open"><div class="modal"><div class="modal-head"><div><h3>Window Update Review</h3><p>${esc(`${dialog.affectedCount} sessions fall outside the updated window. Clear their dates and re-run Smart Fill, or leave them and resolve conflicts manually.`)}</p></div></div><div class="modal-actions"><button class="btn-secondary" data-action="confirmWindowChangeKeep">Keep and Review</button><button class="btn-primary" data-action="confirmWindowChangeClear">Clear Affected Dates</button></div></div></div>`;
}

function shiftDialog() {
  const dialog = state.ui.shiftDialog;
  if (!dialog.open) return "";
  return `<div class="modal-overlay open"><div class="modal"><div class="modal-head"><div><h3>Shift Remaining Sessions?</h3><p>Move only this session, or shift all remaining sessions in this phase?</p></div></div><div class="modal-actions"><button class="btn-secondary" data-action="dismissShiftDialog">Move Only</button><button class="btn-primary" data-action="confirmShiftRemaining">Shift Remaining</button></div></div></div>`;
}

function deleteProjectDialog() {
  const dialog = state.ui.deleteDialog;
  if (!dialog.open) return "";
  return `<div class="modal-overlay open"><div class="modal"><div class="modal-head"><div><h3>Delete Project</h3><p>Permanently delete <strong>${esc(dialog.projectName)}</strong>? This removes all sessions and cannot be undone.</p></div></div><div class="modal-actions"><button class="btn-secondary" data-action="dismissDeleteProject">Cancel</button><button class="btn-danger-outline" data-action="confirmDeleteProject">Delete Project</button></div></div></div>`;
}

function closeProjectDialog() {
  const dialog = state.ui.closeDialog;
  if (!dialog.open) return "";
  return `<div class="modal-overlay open"><div class="modal"><div class="modal-head"><div><h3>Close Project</h3><p>Close <strong>${esc(dialog.projectName)}</strong>? Future calendar events will be removed from your calendar and the IS will be notified to clean up theirs.</p></div></div><div class="modal-actions"><button class="btn-secondary" data-action="dismissCloseProject">Cancel</button><button class="btn-danger-outline" data-action="confirmCloseProject">Close Project</button></div></div></div>`;
}

function projectErrorModal() {
  if (!state.ui.projectError.open) return "";
  return `<div class="modal-overlay open"><div class="modal"><div class="modal-head"><div><h3>Could Not Load Projects</h3><p>${esc(state.ui.projectError.message)}</p></div><button class="btn-secondary btn-sm" data-action="dismissProjectError">Close</button></div><pre class="error-pre">${esc(state.ui.projectError.details || "No diagnostic detail available.")}</pre><div class="modal-actions"><button class="btn-secondary" data-action="dismissProjectError">Close</button><button class="btn-danger-outline" data-action="resetSentinel">Reset Sentinel</button></div></div></div>`;
}

export function render() {
  const app = document.getElementById("app");
  if (!app) return;
  const project = getActiveProject();
  const main = state.ui.screen === "auth" ? authScreen() : state.ui.screen === "workspace" && project ? workspace(project) : projectsScreen();
  app.innerHTML = `${state.ui.screen === "auth" ? "" : topbar()}${main}${onboardingModal()}${settingsModal()}${windowChangeDialog()}${shiftDialog()}${deleteProjectDialog()}${closeProjectDialog()}${projectErrorModal()}${renderDayViewModal()}<div class="toast" id="toast"></div>`;
}
