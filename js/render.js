import { state, getScheduleRow } from "./state.js";
import {
  esc,
  fmt12,
  fmtDateShort,
  fmtDur,
  getTimeOptionsHTML,
  isMobile,
  mondayOf,
  toDateStr,
} from "./utils.js";

function getScheduleMap() {
  return new Map(state.schedule.map((row) => [row.sessionId, row]));
}

function getEventCollections(defaultTime) {
  const scheduleMap = getScheduleMap();
  const eventsByDate = new Map();

  for (const session of state.sessions) {
    const row = scheduleMap.get(session.id);
    if (!row?.date) continue;

    if (!eventsByDate.has(row.date)) eventsByDate.set(row.date, []);
    eventsByDate.get(row.date).push({
      session,
      row,
      time: row.time || defaultTime,
    });
  }

  return { scheduleMap, eventsByDate };
}

export function actionHTML(session, row) {
  const hasSchedule = Boolean(row.date && row.time);

  let graphButton = "";
  if (state.graphAccount) {
    const graphClasses = `lbtn lbtn-graph${row.graphActioned ? " actioned" : ""}`;
    const graphLabel = row.graphActioned
      ? "✓ In Calendar"
      : row.graphEventId
        ? "📅 Update Calendar"
        : "📅 Push to Calendar";

    graphButton = `<button class="${graphClasses}" data-action="pushToCalendar" data-id="${session.id}" ${
      hasSchedule ? "" : "disabled"
    } title="Create or update this event directly in your M365 calendar">${graphLabel}</button>`;
  }

  const outlookClasses = `lbtn lbtn-ol${row.outlookActioned ? " actioned" : ""}`;
  const outlookLabel = row.outlookActioned ? "✓ Opened" : "📧 Outlook Web";
  const outlookTitle = row.outlookActioned
    ? "Outlook Web compose was opened. Review and send the invite in Outlook."
    : "Open a new meeting invite in Outlook Web";

  const outlookButton = `<button class="${outlookClasses}" data-action="openOutlook" data-id="${session.id}" ${
    hasSchedule ? "" : "disabled"
  } title="${outlookTitle}">${outlookLabel}</button>`;

  return graphButton + outlookButton;
}

export function updateStatus() {
  const total = state.sessions.length;
  const scheduled = state.schedule.filter((row) => row.date && row.time).length;
  const totalElement = document.getElementById("stTotal");
  const scheduledElement = document.getElementById("stSched");

  if (totalElement) {
    totalElement.textContent = `${total} session${total !== 1 ? "s" : ""}, ${scheduled} scheduled`;
  }

  if (scheduledElement) {
    scheduledElement.textContent = `${scheduled} / ${total} scheduled`;
  }
}

export function renderChips() {
  const element = document.getElementById("sessionChips");
  const countElement = document.getElementById("sessCount");
  if (!element || !countElement) return;

  countElement.textContent = state.sessions.length ? `(${state.sessions.length})` : "";

  if (!state.sessions.length) {
    element.innerHTML = '<div style="font-size:.72rem;color:var(--text-dim);">No sessions yet</div>';
    return;
  }

  element.innerHTML = state.sessions
    .map(
      (session, index) => `
    <div class="s-chip">
      <span class="s-chip-num">${index + 1}</span>
      <span class="s-chip-name" title="${esc(session.name)}">${esc(session.name)}</span>
      <span class="s-chip-dur">${fmtDur(session.duration)}</span>
      <button class="s-chip-del" data-action="removeSession" data-id="${session.id}">✕</button>
    </div>`
    )
    .join("");
}

export function renderTable() {
  const empty = document.getElementById("emptyState");
  const table = document.getElementById("scheduleTable");
  const tbody = document.getElementById("scheduleBody");
  if (!empty || !table || !tbody) return;

  if (!state.sessions.length) {
    empty.style.display = "block";
    table.style.display = "none";
    return;
  }

  empty.style.display = "none";
  table.style.display = "table";

  const defaultTime = document.getElementById("globalTime")?.value || "09:00";
  const scheduleMap = getScheduleMap();
  const timeOptionsCache = new Map();
  const getOptions = (value) => {
    if (!timeOptionsCache.has(value)) {
      timeOptionsCache.set(value, getTimeOptionsHTML(value));
    }
    return timeOptionsCache.get(value);
  };

  tbody.innerHTML = state.sessions
    .map((session, index) => {
      const row = scheduleMap.get(session.id) || {
        date: "",
        time: "",
        outlookActioned: false,
        graphActioned: false,
        graphEventId: "",
      };
      const selectedTime = row.time || defaultTime;

      return `<tr>
        <td class="seq">${index + 1}</td>
        <td class="sname">${esc(session.name)}</td>
        <td>
          <select class="dur-sel" data-action="setDuration" data-id="${session.id}">
            ${[30, 45, 60, 90, 120, 150, 180, 240, 480]
              .map(
                (minutes) =>
                  `<option value="${minutes}"${
                    minutes === session.duration ? " selected" : ""
                  }>${fmtDur(minutes)}</option>`
              )
              .join("")}
          </select>
        </td>
        <td><div class="date-cell">
          <input type="date" value="${row.date}" data-action="setDate" data-id="${session.id}">
          <span class="dbadge${row.date ? " set" : ""}" id="badge-${session.id}">${
            row.date ? fmtDateShort(row.date) : "Not set"
          }</span>
        </div></td>
        <td><select class="time-sel" data-action="setTime" data-id="${session.id}">${getOptions(
          selectedTime
        )}</select></td>
        <td><div class="act-cell" id="ac-${session.id}">${actionHTML(session, row)}</div></td>
        <td><button class="btn-danger" data-action="removeSession" data-id="${session.id}">✕</button></td>
      </tr>`;
    })
    .join("");
}

export function renderPool() {
  const element = document.getElementById("poolChips");
  if (!element) return;

  const scheduleMap = getScheduleMap();
  const unscheduled = state.sessions.filter((session) => !scheduleMap.get(session.id)?.date);

  if (!unscheduled.length) {
    element.innerHTML = '<span class="pool-empty">All sessions scheduled ✓</span>';
    return;
  }

  element.innerHTML = unscheduled
    .map(
      (session) => `
    <div class="pool-chip" draggable="true" data-drag="pool" data-id="${session.id}">
      ${esc(session.name)} <span class="pc-dur">${fmtDur(session.duration)}</span>
    </div>`
    )
    .join("");
}

export function renderCal() {
  const grid = document.getElementById("calGrid");
  const title = document.getElementById("calTitle");
  if (!grid || !title) return;

  if (!state.calStart) state.calStart = mondayOf(new Date());

  const defaultTime = document.getElementById("globalTime")?.value || "09:00";
  const { eventsByDate } = getEventCollections(defaultTime);
  const today = toDateStr(new Date());
  const mobile = isMobile();
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const colDays = mobile ? 5 : 7;
  const weeks = mobile ? 6 : 8;

  grid.style.gridTemplateColumns = `${mobile ? "30px" : "36px"} repeat(${colDays},1fr)`;

  const endDate = new Date(state.calStart);
  endDate.setDate(endDate.getDate() + (mobile ? 34 : 55));
  title.textContent = `${state.calStart.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })} - ${endDate.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;

  let html = '<div class="cal-col-hdr" style="border-bottom:2px solid var(--border);"></div>';
  days.slice(0, colDays).forEach((day, index) => {
    html += `<div class="cal-col-hdr${index >= 5 ? " wknd" : ""}">${day}</div>`;
  });

  for (let week = 0; week < weeks; week += 1) {
    const weekStart = new Date(state.calStart);
    weekStart.setDate(weekStart.getDate() + week * 7);
    html += `<div class="cal-week-lbl">W${week + 1}</div>`;

    for (let dayIndex = 0; dayIndex < colDays; dayIndex += 1) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + dayIndex);
      const dayString = toDateStr(day);
      const isToday = dayString === today;
      const isWeekend = dayIndex >= 5;
      const classes = `cal-day${isToday ? " today" : ""}${isWeekend ? " wknd" : ""}`;
      const events = eventsByDate.get(dayString) || [];
      const eventHTML = events
        .map(
          ({ session, row, time }) => `<div class="cal-event" draggable="true" data-drag="event" data-id="${session.id}"
            title="${esc(session.name)}&#10;${fmt12(time)} · ${fmtDur(session.duration)}">
            <span class="cal-event-name">${esc(session.name)}</span>
            <span class="cal-event-time">${fmt12(time)}</span>
            <button class="cal-event-x" data-action="unschedule" data-id="${session.id}" title="Unschedule">✕</button>
          </div>`
        )
        .join("");

      html += `<div class="${classes}" data-drop data-date="${dayString}">
        <div class="day-num">${day.getDate()}</div>
        ${eventHTML}
      </div>`;
    }
  }

  grid.innerHTML = html;
}

export function refreshRow(sessionId) {
  const row = getScheduleRow(sessionId);
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!row || !session) return;

  const badge = document.getElementById(`badge-${sessionId}`);
  if (badge) {
    badge.textContent = row.date ? fmtDateShort(row.date) : "Not set";
    badge.className = `dbadge${row.date ? " set" : ""}`;
  }

  const actions = document.getElementById(`ac-${sessionId}`);
  if (actions) actions.innerHTML = actionHTML(session, row);

  updateStatus();
}

export function render() {
  renderChips();
  renderTable();
  renderPool();
  renderCal();
  updateStatus();
}
