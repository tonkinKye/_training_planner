import { getConflicts, getConflictedDates } from "./conflicts.js";
import { fetchCalendarEvents, pushToCalendar } from "./m365.js";
import { state, getScheduleRow, getSession } from "./state.js";
import { closeModal, parseDate, mondayOf, toDateStr, fmt12, fmtDur, esc, pad, toast } from "./utils.js";

const SLOT_HEIGHT = 28;
const SLOT_COUNT = 22;
const HDR_HEIGHT = 32;
const START_HOUR = 7;
const START_MINUTES = START_HOUR * 60;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const conflictReview = {
  queue: [],
  currentSessionId: "",
  currentIndex: -1,
  pendingPushAll: false,
};

let dvWeekStart = null;

function minutesFromTime(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function topPx(minutes) {
  return HDR_HEIGHT + Math.max(0, (minutes - START_MINUTES) / 30 * SLOT_HEIGHT);
}

function heightPx(durationMinutes, startMinutes) {
  const clampedStart = Math.max(startMinutes, START_MINUTES);
  const clampedEnd = Math.min(startMinutes + durationMinutes, START_MINUTES + SLOT_COUNT * 30);
  return Math.max(0, (clampedEnd - clampedStart) / 30 * SLOT_HEIGHT);
}

function isConflictReviewMode() {
  return Boolean(
    conflictReview.currentSessionId ||
      conflictReview.queue.length ||
      conflictReview.pendingPushAll
  );
}

function clearConflictReview() {
  conflictReview.queue = [];
  conflictReview.currentSessionId = "";
  conflictReview.currentIndex = -1;
  conflictReview.pendingPushAll = false;
}

function buildConflictQueue() {
  const conflicts = getConflicts();

  return [...conflicts.keys()]
    .sort((leftId, rightId) => {
      const leftRow = getScheduleRow(leftId);
      const rightRow = getScheduleRow(rightId);
      const leftDate = leftRow?.date || "9999-12-31";
      const rightDate = rightRow?.date || "9999-12-31";
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

      const leftTime = leftRow?.time || "99:99";
      const rightTime = rightRow?.time || "99:99";
      if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);

      return state.sessions.findIndex((session) => session.id === leftId) -
        state.sessions.findIndex((session) => session.id === rightId);
    });
}

function syncConflictReviewQueue() {
  const liveQueue = buildConflictQueue();
  const liveIndex = liveQueue.indexOf(conflictReview.currentSessionId);

  if (!conflictReview.currentSessionId) {
    conflictReview.queue = liveQueue;
    conflictReview.currentIndex = liveQueue.length ? 0 : -1;
    return liveQueue;
  }

  if (liveIndex >= 0) {
    conflictReview.queue = liveQueue;
    conflictReview.currentIndex = liveIndex;
    return liveQueue;
  }

  const preservedIndex = Math.max(conflictReview.currentIndex, 0);
  const preservedQueue = [...liveQueue];
  preservedQueue.splice(
    Math.min(preservedIndex, preservedQueue.length),
    0,
    conflictReview.currentSessionId
  );

  conflictReview.queue = preservedQueue;

  return liveQueue;
}

function setCurrentConflict(sessionId) {
  conflictReview.currentSessionId = sessionId || "";

  if (!sessionId) {
    conflictReview.currentIndex = -1;
    return;
  }

  const queueIndex = conflictReview.queue.indexOf(sessionId);
  conflictReview.currentIndex = queueIndex >= 0 ? queueIndex : Math.max(conflictReview.currentIndex, 0);

  const row = getScheduleRow(sessionId);
  if (row?.date) {
    dvWeekStart = mondayOf(parseDate(row.date));
  }
}

function formatReviewDate(row) {
  if (!row?.date) return "unscheduled";

  return parseDate(row.date).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function updateDayViewControls(conflicts) {
  const metaEl = document.getElementById("dvMeta");
  const confirmBtn = document.getElementById("dvConfirmBtn");
  if (!metaEl || !confirmBtn) return;

  if (!isConflictReviewMode()) {
    metaEl.textContent = "";
    confirmBtn.hidden = true;
    return;
  }

  const session = getSession(conflictReview.currentSessionId);
  const row = getScheduleRow(conflictReview.currentSessionId);
  const currentStillConflicts = conflicts.has(conflictReview.currentSessionId);
  const remaining = conflicts.size;

  confirmBtn.hidden = false;
  confirmBtn.textContent =
    conflictReview.pendingPushAll && !currentStillConflicts && remaining === 0
      ? "Confirm & Push All"
      : "Confirm & Next";

  if (!session) {
    metaEl.textContent = remaining
      ? `Conflict review: ${remaining} conflict${remaining > 1 ? "s" : ""} remaining.`
      : "Conflict review complete.";
    return;
  }

  const dateLabel = formatReviewDate(row);
  const timeLabel = row?.time ? fmt12(row.time) : "not scheduled";
  const progressLabel =
    conflictReview.currentIndex >= 0 && conflictReview.queue.length
      ? `Conflict ${conflictReview.currentIndex + 1} of ${conflictReview.queue.length}`
      : "Resolved";

  metaEl.textContent = currentStillConflicts
    ? `${progressLabel}: ${session.name} on ${dateLabel} at ${timeLabel}. Adjust it, then confirm to continue.`
    : `${session.name} is resolved${row?.date && row?.time ? ` on ${dateLabel} at ${timeLabel}` : ""}. Confirm to continue.`;
}

function syncDayViewViewport({ focusActive = false, resetPosition = false } = {}) {
  const scroll = document.getElementById("dvScroll");
  if (!scroll) return;

  window.requestAnimationFrame(() => {
    if (focusActive) {
      document
        .querySelector(".dv-day-col.active-conflict")
        ?.scrollIntoView({ block: "nearest", inline: "center" });

      const activeSessionEl = document.querySelector(".dv-session.active-conflict");
      if (activeSessionEl) {
        const top = Number.parseFloat(activeSessionEl.style.top || "0");
        scroll.scrollTop = Math.max(top - SLOT_HEIGHT * 2, 0);
        return;
      }
    }

    if (resetPosition) {
      scroll.scrollLeft = 0;
      scroll.scrollTop = SLOT_HEIGHT * 2;
    }
  });
}

function getWeekSessions(weekStart) {
  const days = [];
  for (let i = 0; i < DAY_NAMES.length; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(toDateStr(d));
  }

  const byDate = new Map(days.map((d) => [d, { sessions: [], calEvents: [] }]));

  for (const session of state.sessions) {
    const row = getScheduleRow(session.id);
    if (!row?.date || !row?.time) continue;
    if (byDate.has(row.date)) {
      byDate.get(row.date).sessions.push({ session, row });
    }
  }

  const pushedIds = new Set(
    state.schedule.filter((r) => r.graphEventId).map((r) => r.graphEventId)
  );

  for (const event of state.calendarEvents) {
    if (pushedIds.has(event.id)) continue;
    const parsed = event.start ? new Date(event.start) : null;
    const eventDate = parsed && !isNaN(parsed.getTime()) ? toDateStr(parsed) : null;
    if (eventDate && byDate.has(eventDate)) {
      byDate.get(eventDate).calEvents.push(event);
    }
  }


  return { days, byDate };
}

export function renderDayViewGrid(options = {}) {
  const grid = document.getElementById("dvGrid");
  const titleEl = document.getElementById("dvTitle");
  if (!grid || !dvWeekStart) return;

  if (isConflictReviewMode()) {
    syncConflictReviewQueue();
  }

  const { days, byDate } = getWeekSessions(dvWeekStart);
  const conflicts = getConflicts();
  const today = toDateStr(new Date());
  const activeRow = getScheduleRow(conflictReview.currentSessionId);
  const activeDay = activeRow?.date || "";
  const activeConflictEvents = new Set(
    (conflicts.get(conflictReview.currentSessionId) || []).map((event) => event.id)
  );

  const endDate = new Date(dvWeekStart);
  endDate.setDate(endDate.getDate() + 6);
  if (titleEl) {
    titleEl.textContent = `${dvWeekStart.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
    })} \u2013 ${endDate.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;
  }

  let timeColHTML = '<div class="dv-time-col">';
  for (let i = 0; i < SLOT_COUNT; i++) {
    const mins = START_MINUTES + i * 30;
    const label = i % 2 === 0 ? fmt12(`${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`) : "";
    timeColHTML += `<div class="dv-time-label">${label}</div>`;
  }
  timeColHTML += "</div>";

  let dayColsHTML = "";
  for (let di = 0; di < DAY_NAMES.length; di++) {
    const dateStr = days[di];
    const d = parseDate(dateStr);
    const isToday = dateStr === today;
    const data = byDate.get(dateStr);
    const isActiveDay = activeDay === dateStr;

    let slotsHTML = "";
    for (let i = 0; i < SLOT_COUNT; i++) {
      slotsHTML += '<div class="dv-slot"></div>';
    }

    let eventsHTML = "";

    for (const { session, row } of data.sessions) {
      const startMins = minutesFromTime(row.time);
      const hasConflict = conflicts.has(session.id);
      const isActiveSession = session.id === conflictReview.currentSessionId;
      const top = topPx(startMins);
      const height = heightPx(session.duration, startMins);
      if (height <= 0) continue;

      const sessionClasses = [
        "dv-session",
        hasConflict ? "conflict" : "",
        isActiveSession ? "active-conflict" : "",
        isActiveSession && isConflictReviewMode() && !hasConflict ? "resolved" : "",
      ]
        .filter(Boolean)
        .join(" ");

      eventsHTML += `<div class="${sessionClasses}"
        draggable="true" data-drag="dv-event" data-id="${session.id}"
        style="top:${top}px;height:${height}px;"
        title="${esc(session.name)}&#10;${fmt12(row.time)} \u2013 ${fmtDur(session.duration)}">
        <strong>${esc(session.name)}</strong>
        <span>${fmt12(row.time)}</span>
      </div>`;
    }

    for (const event of data.calEvents) {
      const evStart = event.start ? new Date(event.start) : null;
      const evEnd = event.end ? new Date(event.end) : null;
      if (!evStart || !evEnd || isNaN(evStart.getTime()) || isNaN(evEnd.getTime())) continue;

      const startMins = evStart.getHours() * 60 + evStart.getMinutes();
      const durationMins = (evEnd - evStart) / 60000;
      const top = topPx(startMins);
      const height = heightPx(durationMins, startMins);
      if (height <= 0) continue;

      eventsHTML += `<div class="dv-cal-event${activeConflictEvents.has(event.id) ? " active-conflict" : ""}"
        style="top:${top}px;height:${height}px;"
        title="${esc(event.subject || "Busy")}">
        ${esc(event.subject || "Busy")}
      </div>`;
    }

    const hdrLabel = `${DAY_NAMES[di]} ${d.getDate()}`;
    dayColsHTML += `<div class="dv-day-col${isActiveDay ? " active-conflict" : ""}" data-drop-dv data-date="${dateStr}">
      <div class="dv-day-hdr${isToday ? " today" : ""}${isActiveDay ? " active-conflict" : ""}">${hdrLabel}</div>
      ${slotsHTML}
      ${eventsHTML}
    </div>`;
  }

  grid.innerHTML = timeColHTML + dayColsHTML;
  updateDayViewControls(conflicts);
  syncDayViewViewport(options);
}

export function openDayView(dateString) {
  clearConflictReview();
  dvWeekStart = mondayOf(parseDate(dateString));
  document.getElementById("dayViewModal")?.classList.add("open");
  renderDayViewGrid({ resetPosition: true });
}

export function closeDayView() {
  closeModal("dayViewModal");
  dvWeekStart = null;
  clearConflictReview();
  updateDayViewControls(new Map());
}

export function startConflictReview({ pendingPushAll = false, sessionId = "" } = {}) {
  const queue = buildConflictQueue();
  if (!queue.length) {
    toast("No conflicts");
    return false;
  }

  conflictReview.pendingPushAll = pendingPushAll;
  conflictReview.queue = queue;
  setCurrentConflict(queue.includes(sessionId) ? sessionId : queue[0]);

  document.getElementById("dayViewModal")?.classList.add("open");
  renderDayViewGrid({ focusActive: true });
  return true;
}

export function shiftDayView(direction) {
  if (!dvWeekStart) return;
  dvWeekStart.setDate(dvWeekStart.getDate() + direction * 7);
  renderDayViewGrid();
}

export function navigateConflict(direction) {
  const queue = buildConflictQueue();
  if (!queue.length) {
    toast("No conflicts");
    return;
  }

  if (isConflictReviewMode()) {
    conflictReview.queue = queue;

    let index = queue.indexOf(conflictReview.currentSessionId);
    if (index < 0) index = direction > 0 ? -1 : 0;

    const nextIndex = (index + direction + queue.length) % queue.length;
    setCurrentConflict(queue[nextIndex]);
    renderDayViewGrid({ focusActive: true });
    return;
  }

  const dates = getConflictedDates();
  const currentEnd = dvWeekStart ? toDateStr(new Date(dvWeekStart.getTime() + 6 * 86400000)) : "";
  const currentStart = dvWeekStart ? toDateStr(dvWeekStart) : "";

  let target = null;
  if (direction > 0) {
    target = dates.find((d) => d > currentEnd) || dates[0];
  } else {
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] < currentStart) { target = dates[i]; break; }
    }
    if (!target) target = dates[dates.length - 1];
  }

  dvWeekStart = mondayOf(parseDate(target));
  renderDayViewGrid();
}

async function runPushAllScheduled() {
  const scheduled = state.schedule.filter((r) => r.date && r.time);
  if (!scheduled.length) {
    toast("No sessions are scheduled");
    return;
  }

  const total = scheduled.length;
  let pushed = 0;

  for (const row of scheduled) {
    pushed++;
    toast(`Pushing ${pushed} of ${total}\u2026`);
    await pushToCalendar(row.sessionId);
  }

  await fetchCalendarEvents();
  renderDayViewGrid();
  toast(`${pushed} session${pushed > 1 ? "s" : ""} pushed to calendar`, 4000);
}

export async function pushAllScheduled() {
  const scheduled = state.schedule.filter((row) => row.date && row.time);
  if (!scheduled.length) {
    toast("No sessions are scheduled");
    return;
  }

  toast("Checking for conflicts\u2026");
  await fetchCalendarEvents();

  const conflicts = getConflicts();
  if (conflicts.size) {
    const dates = getConflictedDates();
    toast(
      `Resolve conflicts first \u2014 reviewing ${dates.length} conflicted day${dates.length > 1 ? "s" : ""}`,
      5000
    );
    startConflictReview({ pendingPushAll: true });
    return;
  }

  await runPushAllScheduled();
}

export async function confirmConflict() {
  if (!isConflictReviewMode() || !conflictReview.currentSessionId) {
    toast("No conflict review is active");
    return;
  }

  const conflicts = getConflicts();
  if (conflicts.has(conflictReview.currentSessionId)) {
    syncConflictReviewQueue();
    renderDayViewGrid({ focusActive: true });
    toast("Conflict still overlaps an existing calendar event", 4000);
    return;
  }

  const previousQueue = [...conflictReview.queue];
  const currentIndex = conflictReview.currentIndex;
  const liveQueue = buildConflictQueue();
  if (liveQueue.length) {
    const nextSessionId =
      previousQueue.slice(currentIndex + 1).find((sessionId) => liveQueue.includes(sessionId)) ||
      liveQueue[0];
    conflictReview.queue = liveQueue;
    setCurrentConflict(nextSessionId);
    renderDayViewGrid({ focusActive: true });
    return;
  }

  const resumePushAll = conflictReview.pendingPushAll;
  const currentWeek = dvWeekStart ? toDateStr(dvWeekStart) : "";
  clearConflictReview();

  if (resumePushAll) {
    closeDayView();
    toast("Conflicts resolved. Pushing scheduled sessions\u2026", 4000);
    await runPushAllScheduled();
    return;
  }

  if (currentWeek) {
    dvWeekStart = mondayOf(parseDate(currentWeek));
  }
  renderDayViewGrid();
  toast("All conflicts resolved", 3500);
}
