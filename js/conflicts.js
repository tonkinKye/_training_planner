import { state, getSession, getScheduleRow } from "./state.js";
import { parseDate } from "./utils.js";

function sessionInterval(session, row) {
  const [hours, minutes] = row.time.split(":").map(Number);
  const start = parseDate(row.date);
  start.setHours(hours, minutes, 0, 0);
  const end = new Date(start.getTime() + session.duration * 60000);
  return { start, end };
}

function calEventInterval(event) {
  return { start: new Date(event.start), end: new Date(event.end) };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

export function getConflicts() {
  const conflicts = new Map();
  if (!state.calendarEvents.length) return conflicts;

  for (const session of state.sessions) {
    const row = getScheduleRow(session.id);
    if (!row?.date || !row?.time) continue;

    const sessionRange = sessionInterval(session, row);
    const hits = [];

    for (const event of state.calendarEvents) {
      if (event.id === row.graphEventId) continue;
      if (overlaps(sessionRange, calEventInterval(event))) {
        hits.push(event);
      }
    }

    if (hits.length) conflicts.set(session.id, hits);
  }

  return conflicts;
}

export function getConflictsByDate() {
  const byDate = new Map();
  const conflicts = getConflicts();

  for (const [sessionId, events] of conflicts) {
    const row = getScheduleRow(sessionId);
    if (!row?.date) continue;
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(...events);
  }

  return byDate;
}
