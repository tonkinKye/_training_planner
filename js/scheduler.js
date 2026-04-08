import { PRODUCT_NAME } from "./config.js";
import { FISHBOWL_SESSIONS } from "./session-templates.js";
import {
  calUID,
  createScheduleRow,
  getScheduleRow,
  invalidateRowInviteState,
  saveState,
  state,
  uid,
} from "./state.js";
import { render, renderCal, renderChips, renderPool, refreshRow } from "./render.js";
import { fmtDateShort, fmt12, isMobile, mondayOf, parseDate, toDateStr, toast } from "./utils.js";

export function addSession() {
  const name = document.getElementById("newName")?.value.trim() || "";
  if (!name) {
    toast("Enter a session name");
    return;
  }

  const duration =
    Number(document.getElementById("newDur")?.value) ||
    Number(document.getElementById("globalDuration")?.value) ||
    90;

  const session = { id: uid(), name, duration, calUID: calUID(), seq: 0 };
  state.sessions.push(session);
  state.schedule.push(createScheduleRow(session.id));

  document.getElementById("newName").value = "";
  saveState();
  render();
}

export function removeSession(sessionId) {
  state.sessions = state.sessions.filter((session) => session.id !== sessionId);
  state.schedule = state.schedule.filter((row) => row.sessionId !== sessionId);
  saveState();
  render();
}

export function loadExamples() {
  for (const template of FISHBOWL_SESSIONS) {
    const session = {
      id: uid(),
      name: template.name,
      duration: template.duration,
      calUID: calUID(),
      seq: 0,
    };
    state.sessions.push(session);
    state.schedule.push(createScheduleRow(session.id));
  }

  saveState();
  render();
  toast(`${PRODUCT_NAME} implementation sessions loaded`);
}

export function loadFromJSON() {
  const raw = document.getElementById("jsonPaste")?.value.trim() || "";
  if (!raw) {
    toast("Paste JSON first");
    return;
  }

  try {
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error("Expected an array");

    const defaultDuration = Number(document.getElementById("globalDuration")?.value) || 90;
    for (const item of items) {
      if (!item?.name) continue;
      const session = {
        id: uid(),
        name: String(item.name),
        duration: Number(item.duration) || defaultDuration,
        calUID: calUID(),
        seq: 0,
      };
      state.sessions.push(session);
      state.schedule.push(createScheduleRow(session.id));
    }

    document.getElementById("jsonPaste").value = "";
    saveState();
    render();
    toast("Sessions loaded");
  } catch (error) {
    console.error("Session JSON load failed:", error);
    toast("Invalid JSON");
  }
}

export function setDate(sessionId, value) {
  const row = getScheduleRow(sessionId);
  if (!row) return;

  const nextValue = value || "";
  const priorDate = row.date;
  const priorTime = row.time;

  row.date = nextValue;
  if (!nextValue) {
    row.time = "";
  } else if (!row.time) {
    row.time = document.getElementById("globalTime")?.value || "09:00";
  }

  if (priorDate !== row.date || priorTime !== row.time) {
    invalidateRowInviteState(row);
  }

  saveState();
  renderPool();
  refreshRow(sessionId);
  renderCal();
}

export function setTime(sessionId, value) {
  const row = getScheduleRow(sessionId);
  if (!row) return;

  if (row.time === value) return;
  row.time = value || "";
  invalidateRowInviteState(row);
  saveState();
  refreshRow(sessionId);
  renderCal();
}

export function setDuration(sessionId, value) {
  const session = state.sessions.find((item) => item.id === sessionId);
  const row = getScheduleRow(sessionId);
  if (!session || !row) return;

  const nextDuration = Number(value) || session.duration;
  if (session.duration === nextDuration) return;

  // Invalidate invite state — graphEventId is preserved so the next push
  // will PATCH (update the end time) rather than create a duplicate event.
  session.duration = nextDuration;
  invalidateRowInviteState(row);
  saveState();
  renderChips();
  refreshRow(sessionId);
  renderCal();
}

export function unschedule(sessionId) {
  const row = getScheduleRow(sessionId);
  if (!row) return;

  row.date = "";
  row.time = "";
  invalidateRowInviteState(row);
  saveState();
  renderPool();
  refreshRow(sessionId);
  renderCal();
}

export function toggleSmart() {
  state.smartOpen = !state.smartOpen;
  document.getElementById("smartPanel")?.classList.toggle("open", state.smartOpen);
}

export function toggleActiveDay(day, buttonElement) {
  if (state.activeDays.has(day)) {
    state.activeDays.delete(day);
    buttonElement.classList.remove("on");
  } else {
    state.activeDays.add(day);
    buttonElement.classList.add("on");
  }
}

export function setDayPreset(days) {
  state.activeDays = new Set(days);
  document
    .querySelectorAll(".dt")
    .forEach((button) => button.classList.toggle("on", state.activeDays.has(Number(button.dataset.day))));
}

export function applySmartFill() {
  const startValue = document.getElementById("smartStart")?.value || "";
  if (!startValue) {
    toast("Pick a start date");
    return;
  }

  if (!state.activeDays.size) {
    toast("Select at least one day");
    return;
  }

  const defaultTime = document.getElementById("globalTime")?.value || "09:00";
  let cursor = parseDate(startValue);
  let updatedCount = 0;

  for (const row of state.schedule) {
    if (row.date) continue;

    while (!state.activeDays.has(cursor.getDay())) cursor.setDate(cursor.getDate() + 1);
    row.date = toDateStr(cursor);
    if (!row.time) row.time = defaultTime;
    invalidateRowInviteState(row);
    updatedCount += 1;

    cursor.setDate(cursor.getDate() + 1);
    while (!state.activeDays.has(cursor.getDay())) cursor.setDate(cursor.getDate() + 1);
  }

  saveState();
  render();

  if (updatedCount) {
    const dates = state.schedule.filter((r) => r.date).map((r) => r.date).sort();
    const rangeHint = dates.length >= 2 ? ` (${fmtDateShort(dates[0])} \u2013 ${fmtDateShort(dates[dates.length - 1])})` : "";
    toast(`Filled ${updatedCount} session${updatedCount > 1 ? "s" : ""}${rangeHint}`, 4000);
  } else {
    toast("All sessions already have dates");
  }
}

export function clearDates() {
  const scheduled = state.schedule.filter((row) => row.date).length;
  if (scheduled && !window.confirm(`Clear dates from ${scheduled} scheduled session${scheduled > 1 ? "s" : ""}?`)) {
    return;
  }

  for (const row of state.schedule) {
    row.date = "";
    row.time = "";
    invalidateRowInviteState(row, { preserveGraphEventId: false });
  }

  saveState();
  render();
  toast("Dates cleared");
}

export function applyAllTimes() {
  const timeValue = document.getElementById("globalTime")?.value || "09:00";
  for (const row of state.schedule) {
    if (row.time !== timeValue) {
      row.time = timeValue;
      invalidateRowInviteState(row);
    }
  }

  saveState();
  render();
  toast(`Start time ${fmt12(timeValue)} applied to all sessions`);
}

export function sortByDate() {
  const withDate = state.schedule.filter((row) => row.date).sort((a, b) => a.date.localeCompare(b.date));
  const withoutDate = state.schedule.filter((row) => !row.date);
  const orderedRows = [...withDate, ...withoutDate];

  const reordered = orderedRows.map((row) => state.sessions.find((session) => session.id === row.sessionId));
  const lost = reordered.filter((s) => !s).length;
  if (lost) console.warn(`sortByDate: ${lost} schedule row(s) had no matching session and were dropped.`);
  state.sessions = reordered.filter(Boolean);
  state.schedule = orderedRows;

  saveState();
  render();
}

export function dropOnDate(dateString) {
  if (!state.dragData) return;

  const row = getScheduleRow(state.dragData.sessionId);
  state.dragData = null;
  if (!row) return;

  const priorDate = row.date;
  const priorTime = row.time;
  row.date = dateString;
  if (!row.time) row.time = document.getElementById("globalTime")?.value || "09:00";

  if (priorDate !== row.date || priorTime !== row.time) {
    invalidateRowInviteState(row);
  }

  saveState();
  renderPool();
  renderCal();
  refreshRow(row.sessionId);
}

export function calShift(direction) {
  if (!state.calStart) state.calStart = mondayOf(new Date());
  const weeks = isMobile() ? 6 : 8;
  state.calStart.setDate(state.calStart.getDate() + direction * weeks * 7);
  renderCal();
}

export function calToday() {
  state.calStart = mondayOf(new Date());
  renderCal();
}
