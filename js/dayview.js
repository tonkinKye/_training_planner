import { getConflicts } from "./conflicts.js";
import { pushToCalendar } from "./m365.js";
import { setDate, setTime } from "./scheduler.js";
import { state, getScheduleRow, getSession } from "./state.js";
import { parseDate, mondayOf, toDateStr, fmt12, fmtDur, esc, pad, toast } from "./utils.js";

const SLOT_HEIGHT = 28;
const SLOT_COUNT = 22;
const HDR_HEIGHT = 32;
const START_HOUR = 7;
const START_MINUTES = START_HOUR * 60;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

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

function getWeekSessions(weekStart) {
  const days = [];
  for (let i = 0; i < 5; i++) {
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
    const eventDate = event.start?.split("T")[0];
    if (eventDate && byDate.has(eventDate)) {
      byDate.get(eventDate).calEvents.push(event);
    }
  }

  return { days, byDate };
}

export function renderDayViewGrid() {
  const grid = document.getElementById("dvGrid");
  const titleEl = document.getElementById("dvTitle");
  if (!grid || !dvWeekStart) return;

  const { days, byDate } = getWeekSessions(dvWeekStart);
  const conflicts = getConflicts();
  const today = toDateStr(new Date());

  const endDate = new Date(dvWeekStart);
  endDate.setDate(endDate.getDate() + 4);
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
  for (let di = 0; di < 5; di++) {
    const dateStr = days[di];
    const d = parseDate(dateStr);
    const isToday = dateStr === today;
    const data = byDate.get(dateStr);

    let slotsHTML = "";
    for (let i = 0; i < SLOT_COUNT; i++) {
      slotsHTML += '<div class="dv-slot"></div>';
    }

    let eventsHTML = "";

    for (const { session, row } of data.sessions) {
      const startMins = minutesFromTime(row.time);
      const hasConflict = conflicts.has(session.id);
      const top = topPx(startMins);
      const height = heightPx(session.duration, startMins);
      if (height <= 0) continue;

      eventsHTML += `<div class="dv-session${hasConflict ? " conflict" : ""}"
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
      if (!evStart || !evEnd) continue;

      const startMins = evStart.getHours() * 60 + evStart.getMinutes();
      const durationMins = (evEnd - evStart) / 60000;
      const top = topPx(startMins);
      const height = heightPx(durationMins, startMins);
      if (height <= 0) continue;

      eventsHTML += `<div class="dv-cal-event"
        style="top:${top}px;height:${height}px;"
        title="${esc(event.subject || "Busy")}">
        ${esc(event.subject || "Busy")}
      </div>`;
    }

    const hdrLabel = `${DAY_NAMES[di]} ${d.getDate()}`;
    dayColsHTML += `<div class="dv-day-col" data-drop-dv data-date="${dateStr}">
      <div class="dv-day-hdr${isToday ? " today" : ""}">${hdrLabel}</div>
      ${slotsHTML}
      ${eventsHTML}
    </div>`;
  }

  grid.innerHTML = timeColHTML + dayColsHTML;
}

export function openDayView(dateString) {
  dvWeekStart = mondayOf(parseDate(dateString));
  document.getElementById("dayViewModal")?.classList.add("open");
  renderDayViewGrid();
  const scroll = document.getElementById("dvScroll");
  if (scroll) scroll.scrollTop = 2 * SLOT_HEIGHT;
}

export function shiftDayView(direction) {
  if (!dvWeekStart) return;
  dvWeekStart.setDate(dvWeekStart.getDate() + direction * 7);
  renderDayViewGrid();
}

export async function pushAllScheduled() {
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

  renderDayViewGrid();
  toast(`${pushed} session${pushed > 1 ? "s" : ""} pushed to calendar`, 4000);
}
