import { getActiveProject, state } from "./state.js";
import {
  canEditSession,
  getAllSessions,
  getConflictReviewSessions,
  getEditableSessions,
  getPushableSessions,
  getStageRangeForSession,
  getVisiblePhaseKeys,
  isDateWithinPhaseWindow,
  isDateWithinStageRange,
} from "./projects.js";
import { parseDate, toDateStr } from "./utils.js";

function sessionInterval(session) {
  const [hours, minutes] = String(session.time || "").split(":").map(Number);
  const start = parseDate(session.date);
  start.setHours(hours || 0, minutes || 0, 0, 0);
  const end = new Date(start.getTime() + session.duration * 60000);
  return { start, end };
}

function calendarInterval(event) {
  return {
    start: new Date(event.start),
    end: new Date(event.end),
  };
}

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

function getTargetSessions(project, actor, scope) {
  if (!project) return [];
  if (scope === "pushable") return getPushableSessions(project, actor);
  if (scope === "review") return getConflictReviewSessions(project, actor);
  if (scope === "editable") return getEditableSessions(project, actor);

  const visible = new Set(getVisiblePhaseKeys(actor));
  return getAllSessions(project).filter((session) => visible.has(session.phase) || canEditSession(project, session, actor));
}

function buildPhaseWindowConflict(project, session) {
  const label = session.phase === "implementation" ? "implementation window" : `${session.phase} window`;
  return {
    id: `window:phase:${session.id}`,
    subject: `Outside ${label}`,
    kind: "window",
    windowScope: "phase",
    blocking: true,
    start: session.date && session.time ? `${session.date}T${session.time}:00` : session.date,
    end: session.date && session.time ? `${session.date}T${session.time}:00` : session.date,
  };
}

function buildStageWindowConflict(project, session) {
  const range = getStageRangeForSession(project, session);
  return {
    id: `window:stage:${session.id}`,
    subject: `Outside ${range.label || "Stage"} stage range`,
    kind: "window",
    windowScope: "stage",
    blocking: false,
    start: session.date && session.time ? `${session.date}T${session.time}:00` : session.date,
    end: session.date && session.time ? `${session.date}T${session.time}:00` : session.date,
  };
}

function buildAvailabilityConflict(session) {
  return {
    id: `availability:${session.id}`,
    subject: "No free time found",
    kind: "availability",
    blocking: true,
    start: session.date,
    end: session.date,
  };
}

function filterBlocking(conflicts, blockingOnly) {
  return blockingOnly ? conflicts.filter((conflict) => conflict.blocking !== false) : conflicts;
}

export function summarizeConflictKinds(conflicts = []) {
  const windowCount = conflicts.filter((conflict) => conflict.kind === "window").length;
  const calendarCount = conflicts.filter((conflict) => conflict.kind === "calendar").length;
  const availabilityCount = conflicts.filter((conflict) => conflict.kind === "availability").length;
  const parts = [];

  if (windowCount) {
    parts.push("Outside window");
  }
  if (calendarCount) {
    parts.push(calendarCount > 1 ? "Calendar conflicts" : "Calendar conflict");
  }
  if (availabilityCount) {
    parts.push("No free time");
  }

  return {
    windowCount,
    calendarCount,
    availabilityCount,
    hasWindow: windowCount > 0,
    hasCalendar: calendarCount > 0,
    hasAvailability: availabilityCount > 0,
    windowLabel: windowCount ? "Outside window" : "",
    calendarLabel: calendarCount ? (calendarCount > 1 ? "Calendar conflicts" : "Calendar conflict") : "",
    availabilityLabel: availabilityCount ? "No free time" : "",
    label: parts.join(" + "),
  };
}

export function getConflicts({ project = getActiveProject(), actor = state.actor, scope = "editable", blockingOnly = false } = {}) {
  const conflicts = new Map();
  if (!project) return conflicts;

  const sessions = getTargetSessions(project, actor, scope);
  for (const session of sessions) {
    if (!session.date) continue;

    let hits = [];
    if (!isDateWithinPhaseWindow(project, session, session.date)) {
      hits.push(buildPhaseWindowConflict(project, session));
    }

    if (!isDateWithinStageRange(project, session, session.date)) {
      hits.push(buildStageWindowConflict(project, session));
    }

    if (!session.time) {
      if (session.availabilityConflict) {
        hits.push(buildAvailabilityConflict(session));
      }
    } else {
      const scheduledRange = sessionInterval(session);
      for (const event of state.calendarEvents) {
        if (event.id === session.graphEventId) continue;
        if (overlaps(scheduledRange, calendarInterval(event))) {
          hits.push({
            ...event,
            kind: event.kind || "calendar",
            blocking: true,
          });
        }
      }
    }

    hits = filterBlocking(hits, blockingOnly);
    if (hits.length) conflicts.set(session.id, hits);
  }

  return conflicts;
}

export function getSessionConflicts(sessionId, options = {}) {
  return getConflicts(options).get(sessionId) || [];
}

export function getConflictsByDate(options = {}) {
  const byDate = new Map();
  const conflicts = getConflicts(options);
  const project = options.project || getActiveProject();
  if (!project) return byDate;

  for (const [sessionId, events] of conflicts.entries()) {
    const session = getAllSessions(project).find((candidate) => candidate.id === sessionId);
    if (!session?.date) continue;
    if (!byDate.has(session.date)) byDate.set(session.date, []);
    byDate.get(session.date).push(...events);
  }

  return byDate;
}

export function getConflictedDates(options = {}) {
  return [...getConflictsByDate(options).keys()].sort();
}

export function getCalendarConflictsForDate(dateString, options = {}) {
  const project = options.project || getActiveProject();
  const conflicts = getConflicts({ ...options, project });
  const events = [];
  for (const [sessionId, hits] of conflicts.entries()) {
    const session = getAllSessions(project).find((candidate) => candidate.id === sessionId);
    if (!session || session.date !== dateString) continue;
    events.push(...hits);
  }
  return events;
}

export function getConflictSummary(options = {}) {
  const conflicts = getConflicts(options);
  const dates = new Set();
  let windowSessions = 0;
  let calendarSessions = 0;
  let availabilitySessions = 0;

  for (const sessionId of conflicts.keys()) {
    const project = options.project || getActiveProject();
    const session = getAllSessions(project).find((candidate) => candidate.id === sessionId);
    if (session?.date) dates.add(session.date);
    const summary = summarizeConflictKinds(conflicts.get(sessionId) || []);
    if (summary.hasWindow) windowSessions += 1;
    if (summary.hasCalendar) calendarSessions += 1;
    if (summary.hasAvailability) availabilitySessions += 1;
  }

  const parts = [];
  if (windowSessions) {
    parts.push(`${windowSessions} outside window`);
  }
  if (calendarSessions) {
    parts.push(`${calendarSessions} calendar conflict${calendarSessions > 1 ? "s" : ""}`);
  }
  if (availabilitySessions) {
    parts.push(`${availabilitySessions} no free time`);
  }

  return {
    sessions: conflicts.size,
    dates: dates.size,
    windowSessions,
    calendarSessions,
    availabilitySessions,
    label: parts.join(" | "),
  };
}

export function isPastDateTime(dateString, timeString) {
  if (!dateString || !timeString) return false;
  const now = new Date();
  const slot = parseDate(dateString);
  const [hours, minutes] = timeString.split(":").map(Number);
  slot.setHours(hours, minutes, 0, 0);
  return slot < now;
}

export function normalizeEventDate(dateTimeString) {
  const date = new Date(dateTimeString);
  return Number.isNaN(date.getTime()) ? "" : toDateStr(date);
}
