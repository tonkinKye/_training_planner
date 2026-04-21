import { getConflictedDates, getConflicts, summarizeConflictKinds } from "./conflicts.js";
import { pushOwnedSessions, fetchCalendarEvents } from "./m365.js";
import { getActiveProject, state } from "./state.js";
import { getCalendarOwnerForPhase, getDayViewExternalOwners } from "./calendar-sources.js";
import {
  canEditSession,
  findSession,
  getAllSessions,
  getCalendarOwnerName,
  getContextPhaseKeys,
  getVisiblePhaseKeys,
  PHASE_META,
} from "./projects.js";
import { esc, fmt12, fmtDur, getSessionDurationMinutes, mondayOf, pad, parseDate, toDateStr, toast } from "./utils.js";

const SLOT_HEIGHT = 28;
const SLOT_COUNT = 24;
const HEADER_HEIGHT = 32;
const UNTIMED_STRIP_HEIGHT = 64;
const START_MINUTES = 6 * 60;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getDayViewPhaseClass(phaseKey) {
  if (phaseKey === "setup") return "cal-event-teal";
  if (phaseKey === "implementation") return "cal-event-purple";
  if (phaseKey === "hypercare") return "cal-event-green";
  return "cal-event-gray";
}

const dayViewState = {
  open: false,
  weekStart: null,
  review: {
    queue: [],
    currentSessionId: "",
    currentIndex: -1,
    pendingCommit: false,
  },
};

function syncObservableReviewState() {
  state.ui.dayView.currentSessionId = dayViewState.review.currentSessionId || "";
  state.ui.dayView.pendingCommit = Boolean(dayViewState.review.pendingCommit);
}

function isReviewMode() {
  return Boolean(dayViewState.review.queue.length || dayViewState.review.currentSessionId);
}

function clearReview() {
  dayViewState.review = {
    queue: [],
    currentSessionId: "",
    currentIndex: -1,
    pendingCommit: false,
  };
  syncObservableReviewState();
}

function minutesFromTime(timeValue) {
  const [hours, minutes] = String(timeValue || "00:00").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function topPx(minutes) {
  return HEADER_HEIGHT + UNTIMED_STRIP_HEIGHT + Math.max(0, ((minutes - START_MINUTES) / 30) * SLOT_HEIGHT);
}

function heightPx(duration, startMinutes) {
  const clampedStart = Math.max(startMinutes, START_MINUTES);
  const clampedEnd = Math.min(startMinutes + duration, START_MINUTES + SLOT_COUNT * 30);
  return Math.max(0, ((clampedEnd - clampedStart) / 30) * SLOT_HEIGHT);
}

function buildConflictQueue() {
  const project = getActiveProject();
  if (!project) return [];
  const conflicts = getConflicts({ project, actor: state.actor, scope: "review", blockingOnly: true });

  return [...conflicts.keys()].sort((leftId, rightId) => {
    const left = findSession(project, leftId)?.session;
    const right = findSession(project, rightId)?.session;
    const leftDate = left?.date || "9999-12-31";
    const rightDate = right?.date || "9999-12-31";
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

    const leftTime = left?.time || "99:99";
    const rightTime = right?.time || "99:99";
    if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);

    return (left?.order || 0) - (right?.order || 0);
  });
}

function syncReviewQueue() {
  const liveQueue = buildConflictQueue();
  if (!dayViewState.review.currentSessionId) {
    dayViewState.review.queue = liveQueue;
    dayViewState.review.currentIndex = liveQueue.length ? 0 : -1;
    return liveQueue;
  }

  const liveIndex = liveQueue.indexOf(dayViewState.review.currentSessionId);
  dayViewState.review.queue = liveQueue;
  dayViewState.review.currentIndex = liveIndex;
  return liveQueue;
}

function setCurrentReviewSession(sessionId) {
  dayViewState.review.currentSessionId = sessionId || "";
  dayViewState.review.currentIndex = dayViewState.review.queue.indexOf(sessionId);
  syncObservableReviewState();
  const session = getActiveProject() ? findSession(getActiveProject(), sessionId)?.session : null;
  if (session?.date) {
    dayViewState.weekStart = mondayOf(parseDate(session.date));
  }
}

function getReviewSession() {
  const project = getActiveProject();
  return project ? findSession(project, dayViewState.review.currentSessionId)?.session || null : null;
}

function getHeaderContext() {
  const project = getActiveProject();
  if (!project) {
    return {
      title: "Week View",
      subhead: "",
    };
  }

  const activeSession = getReviewSession();
  if (!activeSession && state.actor === "pm") {
    return {
      title: "Project Calendars",
      subhead: "PM + IS calendars",
    };
  }

  const phaseKey = activeSession?.phase || "implementation";
  const ownerName = getCalendarOwnerName(project, phaseKey);
  const stageLabel = activeSession ? findSession(project, activeSession.id)?.stage?.label || "" : "";
  return {
    title: `${PHASE_META[phaseKey]?.label || "Project"} Phase`,
    subhead: `${ownerName}'s Calendar${stageLabel ? ` | ${stageLabel}` : ""}`,
  };
}

function getWeekDates() {
  const start = dayViewState.weekStart || mondayOf(new Date());
  const dates = [];
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    dates.push(toDateStr(date));
  }
  return dates;
}

function getExternalEventsByDate(project) {
  const byDate = new Map();
  const allowedOwners = new Set(
    getDayViewExternalOwners({ actor: state.actor })
  );
  const pushedIds = new Set(
    getAllSessions(project)
      .map((session) => session.graphEventId)
      .filter(Boolean)
  );

  for (const event of state.calendarEvents) {
    if (!allowedOwners.has(event.calendarOwner || getCalendarOwnerForPhase("setup"))) continue;
    if (pushedIds.has(event.graphId || event.id)) continue;
    const start = event.start ? new Date(event.start) : null;
    if (!start || Number.isNaN(start.getTime())) continue;
    const date = toDateStr(start);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(event);
  }

  return byDate;
}

function getSessionBlocksByDate(project) {
  const visible = new Set(getVisiblePhaseKeys(state.actor));
  const context = new Set(getContextPhaseKeys(state.actor));
  const timedByDate = new Map();
  const untimedByDate = new Map();

  for (const session of getAllSessions(project)) {
    if (!session.date) continue;
    if (!visible.has(session.phase) && !context.has(session.phase)) continue;
    const target = session.time ? timedByDate : untimedByDate;
    if (!target.has(session.date)) target.set(session.date, []);
    const stage = findSession(project, session.id)?.stage || null;
    target.get(session.date).push({
      session,
      editable: canEditSession(project, session, state.actor) && !session.lockedDate,
      context: context.has(session.phase),
      stageLabel: stage?.label || "",
    });
  }

  return {
    timedByDate,
    untimedByDate,
  };
}

function renderTimeColumn() {
  let html = '<div class="tp-dv-time-col">';
  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const minutes = START_MINUTES + index * 30;
    const label = index % 2 === 0 ? fmt12(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`) : "";
    html += `<div class="tp-dv-time-label">${label}</div>`;
  }
  html += "</div>";
  return html;
}

function renderSessionBlock(project, block, conflicts) {
  const { session, editable, context, stageLabel } = block;
  const conflictHits = conflicts.get(session.id) || [];
  const conflictSummary = summarizeConflictKinds(conflictHits);
  const startMinutes = minutesFromTime(session.time);
  const height = heightPx(getSessionDurationMinutes(session), startMinutes);
  if (!height) return "";

  const classes = [
    "tp-dv-block",
    "cal-event",
    getDayViewPhaseClass(session.phase),
    editable ? "" : "is-readonly",
    context ? "is-context" : "",
    conflictSummary.hasCalendar ? "is-calendar-conflict" : "",
    conflictSummary.hasWindow ? "is-window-conflict" : "",
    dayViewState.review.currentSessionId === session.id ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<div class="${classes}" ${
    editable ? `draggable="true" data-drag="dayview-session" data-id="${session.id}"` : ""
  } style="top:${topPx(startMinutes)}px;height:${height}px;" title="${esc(session.name)}&#10;${fmt12(
    session.time
  )} | ${fmtDur(getSessionDurationMinutes(session))}${stageLabel ? ` | ${esc(stageLabel)}` : ""}${conflictSummary.label ? ` | ${esc(conflictSummary.label)}` : ""}">
    <strong>${esc(session.name)}</strong>
    ${stageLabel ? `<small>${esc(stageLabel)}</small>` : ""}
    <span>${fmt12(session.time)}</span>
  </div>`;
}

function renderUntimedItem(project, block, conflicts) {
  const { session, editable, context, stageLabel } = block;
  const conflictHits = conflicts.get(session.id) || [];
  const conflictSummary = summarizeConflictKinds(conflictHits);
  const classes = [
    "tp-dv-block",
    "cal-event",
    "tp-dv-untimed-item",
    getDayViewPhaseClass(session.phase),
    editable ? "" : "is-readonly",
    context ? "is-context" : "",
    conflictSummary.hasAvailability ? "is-availability-conflict" : "",
    conflictSummary.hasWindow ? "is-window-conflict" : "",
    dayViewState.review.currentSessionId === session.id ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<div class="${classes}" ${editable ? `draggable="true" data-drag="dayview-session" data-id="${session.id}"` : ""} title="${esc(
    session.name
  )}${stageLabel ? `&#10;${esc(stageLabel)}` : ""}${conflictSummary.label ? `&#10;${esc(conflictSummary.label)}` : ""}">
    <strong>${esc(session.name)}</strong>
    ${stageLabel ? `<small>${esc(stageLabel)}</small>` : ""}
    <span>Time needed</span>
  </div>`;
}

function renderExternalBlock(event, activeConflictIds) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const duration = Math.max(30, (end.getTime() - start.getTime()) / 60000);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const classes = ["tp-dv-block", "cal-event", "cal-event-gray", "is-external", activeConflictIds.has(event.id) ? "is-active" : ""]
    .filter(Boolean)
    .join(" ");

  return `<div class="${classes}" style="top:${topPx(startMinutes)}px;height:${heightPx(
    duration,
    startMinutes
  )}px;" title="${esc(event.subject || "Busy")}">${esc(event.subject || "Busy")}</div>`;
}

function renderDayColumn(project, dateString, index, timedBlocks, untimedBlocks, externalEvents, conflicts) {
  const date = parseDate(dateString);
  const today = toDateStr(new Date());
  const activeSession = getReviewSession();
  const activeConflictIds = new Set((conflicts.get(dayViewState.review.currentSessionId) || []).map((event) => event.id));
  const activeConflictSummary = summarizeConflictKinds(conflicts.get(dayViewState.review.currentSessionId) || []);
  const isActiveDay = activeSession?.date === dateString;
  let slots = "";
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    slots += '<div class="tp-dv-slot"></div>';
  }

  const sessionsHTML = (timedBlocks || [])
    .sort((left, right) => minutesFromTime(left.session.time) - minutesFromTime(right.session.time))
    .map((block) => renderSessionBlock(project, block, conflicts))
    .join("");
  const untimedHTML = (untimedBlocks || []).map((block) => renderUntimedItem(project, block, conflicts)).join("");
  const externalHTML = (externalEvents || [])
    .map((event) => renderExternalBlock(event, activeConflictIds))
    .join("");

  return `<div class="tp-dv-day-col${isActiveDay ? " is-active" : ""}${isActiveDay && activeConflictSummary.hasCalendar ? " is-active-calendar-conflict" : ""}${isActiveDay && activeConflictSummary.hasWindow ? " is-active-window-conflict" : ""}${isActiveDay && activeConflictSummary.hasAvailability ? " is-active-availability-conflict" : ""}" data-drop-dv data-date="${dateString}">
    <div class="tp-dv-day-hdr${dateString === today ? " cal-day-today" : ""}">
      <span>${DAY_NAMES[index]}</span>
      <strong>${date.getDate()}</strong>
    </div>
    <div class="tp-dv-untimed">${untimedHTML || '<span class="tp-dv-empty">No date-only items</span>'}</div>
    ${slots}
    ${externalHTML}
    ${sessionsHTML}
  </div>`;
}

function renderReviewMeta(project, conflicts) {
  if (!isReviewMode()) return "";
  const session = getReviewSession();
  if (!session) return `<div class="tp-dv-review">Conflict review complete.</div>`;

  const progress = dayViewState.review.currentIndex >= 0 ? `${dayViewState.review.currentIndex + 1} / ${dayViewState.review.queue.length}` : "";
  const ownerName = getCalendarOwnerName(project, session.phase);
  const currentConflicts = conflicts.get(session.id) || [];
  const summary = summarizeConflictKinds(currentConflicts);
  const label = currentConflicts.length
    ? `Resolve ${session.name} in ${ownerName}'s calendar, then confirm to continue.${summary.label ? ` ${summary.label}.` : ""}`
    : `${session.name} is clear. Confirm to continue.`;
  return `<div class="tp-dv-review">${progress ? `<strong>${progress}</strong> | ` : ""}${esc(label)}</div>`;
}

export function renderDayViewModal() {
  if (!dayViewState.open) return "";

  const project = getActiveProject();
  if (!project) return "";

  if (isReviewMode()) {
    syncReviewQueue();
  }

  const { title, subhead } = getHeaderContext();
  const weekDates = getWeekDates();
  const weekStart = dayViewState.weekStart || mondayOf(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const conflicts = getConflicts({
    project,
    actor: state.actor,
    scope: isReviewMode() ? "review" : "editable",
    blockingOnly: isReviewMode(),
  });
  const sessionBlocks = getSessionBlocksByDate(project);
  const externalBlocks = getExternalEventsByDate(project);

  return `<div class="tp-modal-overlay is-open" id="dayViewModal">
    <div class="tp-modal tp-dv-modal">
      <div class="tp-dv-header">
        <div class="tp-dv-copy">
          <h3>${esc(title)}</h3>
          <p>${esc(subhead)} | ${weekStart.toLocaleDateString("en-AU", {
            day: "numeric",
            month: "short",
          })} - ${weekEnd.toLocaleDateString("en-AU", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}</p>
        </div>
        <div class="tp-dv-nav">
          <button class="btn-default btn-sm" data-action="shiftDayView" data-dir="-1">Prev Week</button>
          <button class="btn-default btn-sm" data-action="shiftDayView" data-dir="1">Next Week</button>
          <button class="btn-default btn-sm" data-action="navigateConflict" data-dir="-1">Prev Conflict</button>
          <button class="btn-default btn-sm" data-action="navigateConflict" data-dir="1">Next Conflict</button>
        </div>
        <button class="btn-default btn-sm" data-action="closeDayView">Close</button>
      </div>
      ${renderReviewMeta(project, conflicts)}
      <div class="tp-dv-scroll" id="dvScroll">
        <div class="tp-dv-grid" id="dvGrid">
          ${renderTimeColumn()}
          ${weekDates
            .map((dateString, index) =>
              renderDayColumn(
                project,
                dateString,
                index,
                sessionBlocks.timedByDate.get(dateString),
                sessionBlocks.untimedByDate.get(dateString),
                externalBlocks.get(dateString),
                conflicts
              )
            )
            .join("")}
        </div>
      </div>
      <div class="tp-modal-actions">
        <button class="btn-default" data-action="closeDayView">Close</button>
        ${
          isReviewMode()
            ? `<button class="btn-amber" data-action="confirmConflict">${
                dayViewState.review.pendingCommit ? "Confirm & Continue" : "Confirm & Next"
              }</button>`
            : ""
        }
      </div>
    </div>
  </div>`;
}

export function openDayView(dateString) {
  dayViewState.open = true;
  clearReview();
  dayViewState.weekStart = mondayOf(parseDate(dateString));
}

export function closeDayView() {
  dayViewState.open = false;
  dayViewState.weekStart = null;
  clearReview();
}

export function shiftDayView(direction) {
  const base = dayViewState.weekStart || mondayOf(new Date());
  base.setDate(base.getDate() + direction * 7);
  dayViewState.weekStart = mondayOf(base);
}

export function navigateConflict(direction) {
  const queue = buildConflictQueue();
  if (!queue.length) {
    const dates = getConflictedDates({ actor: state.actor, scope: "review", blockingOnly: true });
    if (!dates.length) {
      toast("No conflicts");
      return;
    }

    const targetDate = direction > 0 ? dates[0] : dates[dates.length - 1];
    dayViewState.open = true;
    dayViewState.weekStart = mondayOf(parseDate(targetDate));
    return;
  }

  dayViewState.review.queue = queue;
  let currentIndex = queue.indexOf(dayViewState.review.currentSessionId);
  if (currentIndex < 0) currentIndex = direction > 0 ? -1 : 0;
  const nextIndex = (currentIndex + direction + queue.length) % queue.length;
  setCurrentReviewSession(queue[nextIndex]);
  dayViewState.open = true;
}

export function startConflictReview({ pendingCommit = false, focusSessionId = "" } = {}) {
  const queue = buildConflictQueue();
  if (!queue.length) {
    toast("No conflicts found");
    return false;
  }

  dayViewState.open = true;
  dayViewState.review.queue = queue;
  dayViewState.review.pendingCommit = pendingCommit;
  syncObservableReviewState();
  setCurrentReviewSession(queue.includes(focusSessionId) ? focusSessionId : queue[0]);
  return true;
}

export async function confirmConflict() {
  if (!isReviewMode()) {
    toast("No conflict review is active");
    return false;
  }

  const project = getActiveProject();
  if (!project) return false;
  const currentId = dayViewState.review.currentSessionId;
  const conflicts = getConflicts({ project, actor: state.actor, scope: "review", blockingOnly: true });
  if (conflicts.has(currentId)) {
    toast("This item still needs review for window, calendar, or availability conflicts.", 4000);
    return false;
  }

  const liveQueue = buildConflictQueue();
  if (liveQueue.length) {
    const currentIndex = liveQueue.indexOf(currentId);
    const nextId = liveQueue[Math.min(currentIndex >= 0 ? currentIndex : 0, liveQueue.length - 1)] || liveQueue[0];
    dayViewState.review.queue = liveQueue;
    setCurrentReviewSession(nextId);
    return true;
  }

  const pendingCommit = dayViewState.review.pendingCommit;
  clearReview();

  if (pendingCommit) {
    closeDayView();
    const pushed = await pushOwnedSessions({ actor: state.actor });
    if (pushed) {
      toast(state.actor === "is" ? "Implementation committed to calendar" : "PM-owned sessions pushed to calendar", 4000);
    }
    return true;
  }

  toast("All conflicts resolved", 3500);
  return true;
}

export async function runPushWorkflow() {
  const project = getActiveProject();
  if (!project) return false;
  await fetchCalendarEvents({ project });
  const hasConflicts = buildConflictQueue().length > 0;
  if (hasConflicts) {
    startConflictReview({ pendingCommit: true });
    return false;
  }
  const pushed = await pushOwnedSessions({ actor: state.actor });
  if (pushed) {
    toast(state.actor === "is" ? "Implementation committed to calendar" : "PM-owned sessions pushed to calendar", 4000);
  }
  return pushed > 0;
}
