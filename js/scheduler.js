import {
  clearProjectError,
  getActiveProject,
  setActiveProject,
  setActorMode,
  setScreen,
  state,
  upsertProject,
} from "./state.js";
import {
  addCustomSession,
  canEditSession,
  cloneProject,
  createOnboardingDraft,
  createProjectFromDraft,
  deriveProjectStatus,
  findSession,
  getAllSessions,
  getConflictReviewSessions,
  getEditableSessions,
  getPhaseSessions,
  getProjectById,
  getProjectDateRange,
  getPushableSessions,
  getWindowForPhase,
  isDateWithinPhaseWindow,
  moveSession,
  normalizeProject,
  PHASE_ORDER,
  projectHasImplementationReady,
  removeSession,
  touchProject,
} from "./projects.js";
import { getTemplateReviewJSON, getTemplateSessions } from "./session-templates.js";
import { mondayOf, parseDate, toDateStr, toast } from "./utils.js";

const SMART_FILL_PREFERENCES = new Set(["am", "none", "pm"]);
const WORK_START_MINUTES = 8 * 60 + 30;
const HALF_DAY_BOUNDARY_MINUTES = 12 * 60;
const WORK_END_MINUTES = 17 * 60;
const SLOT_INCREMENT_MINUTES = 30;
const IMPLEMENTATION_BASE_WEEKLY_CAP = 2;
const IMPLEMENTATION_PROMOTED_WEEKLY_CAP = 3;

function invalidateSessionInviteState(session, { preserveGraphEventId = true } = {}) {
  session.graphActioned = false;
  session.outlookActioned = false;
  if (!preserveGraphEventId) {
    session.graphEventId = "";
  }
}

function getTodayString() {
  return toDateStr(new Date());
}

function getCurrentProjectOrToast() {
  const project = getActiveProject();
  if (!project) {
    toast("Select a project first");
    return null;
  }
  return project;
}

function ensureFutureDate(value) {
  return !value || value >= getTodayString();
}

function setCalendarStartFromProject(project) {
  const range = getProjectDateRange(project);
  state.calStart = mondayOf(parseDate(range.start || getTodayString()));
}

function createDraftFromAccount() {
  const draft = createOnboardingDraft();
  if (state.graphAccount) {
    draft.pmName = state.graphAccount.name || "";
    draft.pmEmail = state.graphAccount.username || "";
  }
  return draft;
}

function normalizeSmartFillPreference(value) {
  return SMART_FILL_PREFERENCES.has(value) ? value : "none";
}

function resetSmartFillPreference(project) {
  state.ui.smartPreference = normalizeSmartFillPreference(project?.smartFillPreference);
}

function clearWindowChangeDialog() {
  state.ui.windowChangeDialog = {
    open: false,
    nextProject: null,
    affectedSessionIds: [],
    affectedCount: 0,
  };
}

function queueWindowChangeDialog(nextProject, affectedSessionIds) {
  state.ui.windowChangeDialog = {
    open: true,
    nextProject,
    affectedSessionIds: [...affectedSessionIds],
    affectedCount: affectedSessionIds.length,
  };
}

function applySavedProject(project) {
  upsertProject(project);
  setActiveProject(project.id);
  setCalendarStartFromProject(project);
  resetSmartFillPreference(project);
  clearWindowChangeDialog();
  closeSettings();
  return project;
}

function toMinutes(timeValue) {
  const [hours, minutes] = String(timeValue || "00:00").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function toTimeString(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function compareSessions(left, right) {
  if (left.phase !== right.phase) {
    return PHASE_ORDER.indexOf(left.phase) - PHASE_ORDER.indexOf(right.phase);
  }
  return (left.order || 0) - (right.order || 0);
}

function compareDatedSessions(left, right) {
  const leftDate = left.date || "9999-12-31";
  const rightDate = right.date || "9999-12-31";
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }
  return compareSessions(left, right);
}

function getEditablePhaseKeys(project, actor = state.actor) {
  return PHASE_ORDER.filter((phaseKey) =>
    project.phases[phaseKey]?.sessions?.some((session) => canEditSession(project, session, actor))
  );
}

function getSmartFillSearchStart(dateString, windowMin = "") {
  const today = getTodayString();
  const candidates = [today, dateString || today, windowMin || ""].filter(Boolean).sort();
  return candidates[candidates.length - 1] || today;
}

function getEligibleDatesForPhase(project, phaseKey, startDate) {
  const window = getWindowForPhase(project, phaseKey);
  const searchStart = getSmartFillSearchStart(startDate, window.min);
  const searchEnd = window.max || searchStart;
  if (searchStart > searchEnd) return [];

  const dates = [];
  const cursor = parseDate(searchStart);
  const endDate = parseDate(searchEnd);
  while (cursor <= endDate) {
    if (state.ui.activeDays.has(cursor.getDay())) {
      dates.push(toDateStr(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function applySessionDate(session, dateString) {
  session.date = dateString;
  session.time = "";
  session.availabilityConflict = false;
  invalidateSessionInviteState(session);
}

function clearSessionScheduling(session, { preserveGraphEventId = false } = {}) {
  session.date = "";
  session.time = "";
  session.availabilityConflict = false;
  invalidateSessionInviteState(session, { preserveGraphEventId });
}

function groupDatesByWeek(eligibleDates) {
  const weeks = new Map();
  for (const dateString of eligibleDates) {
    const weekKey = toDateStr(mondayOf(parseDate(dateString)));
    if (!weeks.has(weekKey)) {
      weeks.set(weekKey, []);
    }
    weeks.get(weekKey).push(dateString);
  }
  return [...weeks.entries()].map(([weekKey, dates]) => ({
    weekKey,
    dates,
    physicalCapacity: dates.length * 2,
    capacity: Math.min(IMPLEMENTATION_BASE_WEEKLY_CAP, dates.length * 2),
  }));
}

function assignSessionsAcrossDates(sessions, eligibleDates, limit = sessions.length) {
  const assignments = [];
  let sessionIndex = 0;

  for (const dateString of eligibleDates) {
    if (sessionIndex >= sessions.length || assignments.length >= limit) break;
    assignments.push([sessions[sessionIndex], dateString]);
    sessionIndex += 1;
  }

  for (const dateString of eligibleDates) {
    if (sessionIndex >= sessions.length || assignments.length >= limit) break;
    assignments.push([sessions[sessionIndex], dateString]);
    sessionIndex += 1;
  }

  return {
    assignments,
    placed: sessionIndex,
  };
}

function distributePhaseDates(project, phaseKey, sessions, startDate) {
  const eligibleDates = getEligibleDatesForPhase(project, phaseKey, startDate);
  if (!eligibleDates.length || !sessions.length) {
    return {
      placed: [],
      unplaced: [...sessions],
    };
  }

  if (phaseKey !== "implementation") {
    const { assignments, placed } = assignSessionsAcrossDates(sessions, eligibleDates);
    return {
      placed: assignments,
      unplaced: sessions.slice(placed),
    };
  }

  const weeks = groupDatesByWeek(eligibleDates);
  let totalCapacity = weeks.reduce((sum, week) => sum + week.capacity, 0);
  if (totalCapacity < sessions.length) {
    for (const week of weeks) {
      const promotedCapacity = Math.min(IMPLEMENTATION_PROMOTED_WEEKLY_CAP, week.physicalCapacity);
      if (promotedCapacity <= week.capacity) continue;
      totalCapacity += promotedCapacity - week.capacity;
      week.capacity = promotedCapacity;
      if (totalCapacity >= sessions.length) break;
    }
  }

  const assignments = [];
  let sessionIndex = 0;
  for (const week of weeks) {
    if (sessionIndex >= sessions.length) break;
    const { assignments: weeklyAssignments, placed } = assignSessionsAcrossDates(
      sessions.slice(sessionIndex),
      week.dates,
      week.capacity
    );
    assignments.push(...weeklyAssignments);
    sessionIndex += placed;
  }

  return {
    placed: assignments,
    unplaced: sessions.slice(sessionIndex),
  };
}

export function getSmartFillCoverageRange(project = getActiveProject(), actor = state.actor, startDate = state.ui.smartStart) {
  if (!project) {
    const today = getTodayString();
    return { start: today, end: today };
  }

  const relevantSessions = getEditableSessions(project, actor);
  const dated = relevantSessions.filter((session) => session.date).map((session) => session.date);
  const phaseDates = [];

  for (const phaseKey of getEditablePhaseKeys(project, actor)) {
    const window = getWindowForPhase(project, phaseKey);
    const phaseStart = getSmartFillSearchStart(startDate, window.min);
    const phaseEnd = window.max || phaseStart;
    if (phaseStart <= phaseEnd) {
      phaseDates.push(phaseStart, phaseEnd);
    }
  }

  const allDates = [...dated, ...phaseDates].filter(Boolean).sort();
  const today = getTodayString();
  return {
    start: allDates[0] || today,
    end: allDates[allDates.length - 1] || today,
  };
}

export function getSmartAvailabilityState(project = getActiveProject(), actor = state.actor) {
  if (!project) {
    return { ready: false, reason: "no_project" };
  }

  const requiredRange = getSmartFillCoverageRange(project, actor);
  const availability = state.calendarAvailability;
  if (availability.status !== "ready") {
    return { ready: false, reason: availability.status === "error" ? "error" : "not_loaded", requiredRange };
  }
  if (availability.projectId !== project.id) {
    return { ready: false, reason: "project_mismatch", requiredRange };
  }
  if (availability.rangeStart > requiredRange.start || availability.rangeEnd < requiredRange.end) {
    return { ready: false, reason: "range_mismatch", requiredRange };
  }
  return {
    ready: true,
    reason: "",
    requiredRange,
  };
}

function getDateEvents(dateString) {
  return state.calendarEvents.filter((event) => event.start?.slice(0, 10) === dateString);
}

function getTimedIntervalsForDate(project, actor, dateString, currentSessionId = "", pendingAssignments = new Map()) {
  const intervals = [];

  for (const event of getDateEvents(dateString)) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    intervals.push({
      start: start.getHours() * 60 + start.getMinutes(),
      end: end.getHours() * 60 + end.getMinutes(),
    });
  }

  for (const session of getAllSessions(project)) {
    if (session.id === currentSessionId) continue;
    if (session.date !== dateString || !session.time) continue;
    intervals.push({
      start: toMinutes(session.time),
      end: toMinutes(session.time) + session.duration,
    });
  }

  for (const [sessionId, timeValue] of pendingAssignments.entries()) {
    if (sessionId === currentSessionId || !timeValue) continue;
    const found = findSession(project, sessionId)?.session;
    if (!found || found.date !== dateString) continue;
    intervals.push({
      start: toMinutes(timeValue),
      end: toMinutes(timeValue) + found.duration,
    });
  }

  return intervals.sort((left, right) => left.start - right.start);
}

function findOpenSlot(duration, intervals, preferredHalf) {
  const halfRanges =
    preferredHalf === "pm"
      ? [
          [HALF_DAY_BOUNDARY_MINUTES, WORK_END_MINUTES],
          [WORK_START_MINUTES, HALF_DAY_BOUNDARY_MINUTES],
        ]
      : [
          [WORK_START_MINUTES, HALF_DAY_BOUNDARY_MINUTES],
          [HALF_DAY_BOUNDARY_MINUTES, WORK_END_MINUTES],
        ];

  for (const [rangeStart, rangeEnd] of halfRanges) {
    for (let minutes = rangeStart; minutes + duration <= rangeEnd; minutes += SLOT_INCREMENT_MINUTES) {
      const candidateEnd = minutes + duration;
      const overlaps = intervals.some((interval) => minutes < interval.end && candidateEnd > interval.start);
      if (!overlaps) {
        return toTimeString(minutes);
      }
    }
  }

  return "";
}

function detectAffectedWindowSessions(project) {
  return getAllSessions(project)
    .filter((session) => session.date && !isDateWithinPhaseWindow(project, session, session.date))
    .map((session) => session.id);
}

function validateDraft(draft) {
  if (!draft.clientName.trim()) return "Client name is required";
  if (!draft.pmEmail.trim()) return "PM email is required";
  if (!draft.isEmail.trim()) return "IS email is required";
  if (!draft.implementationStart) return "Implementation start date is required";
  if (!draft.goLiveDate) return "Go-Live date is required";
  if (draft.goLiveDate <= draft.implementationStart) {
    return "Go-Live date must be after the implementation start date";
  }
  return "";
}

function ensureSettingsDraft(project) {
  state.ui.settings.draft = cloneProject(project);
  state.ui.settings.draft.newSession = {
    phase: "implementation",
    owner: "is",
    name: "",
    duration: 90,
    type: "external",
  };
}

export function openOnboarding() {
  state.ui.onboarding.open = true;
  state.ui.onboarding.step = 0;
  state.ui.onboarding.draft = createDraftFromAccount();
  state.ui.onboarding.templateReviewJSON = getTemplateReviewJSON();
}

export function closeOnboarding() {
  state.ui.onboarding.open = false;
  state.ui.onboarding.step = 0;
  state.ui.onboarding.draft = null;
}

export function nextOnboardingStep() {
  state.ui.onboarding.step = Math.min(state.ui.onboarding.step + 1, 6);
}

export function prevOnboardingStep() {
  state.ui.onboarding.step = Math.max(state.ui.onboarding.step - 1, 0);
}

export function updateOnboardingField(field, value) {
  if (!state.ui.onboarding.draft) return;

  if (field === "projectType") {
    state.ui.onboarding.draft.projectType = value;
    state.ui.onboarding.draft.sessions = getTemplateSessions(value);
    return;
  }

  if (field === "invitees") {
    state.ui.onboarding.draft.invitees = value;
    return;
  }

  if (field.startsWith("customSession.")) {
    const key = field.split(".")[1];
    state.ui.onboarding.draft.customSession[key] = key === "duration" ? Number(value) || 90 : value;
    return;
  }

  state.ui.onboarding.draft[field] = value;
}

export function addOnboardingSession() {
  const draft = state.ui.onboarding.draft;
  if (!draft) return;

  const { name, duration, phase, owner, type } = draft.customSession;
  if (!name.trim()) {
    toast("Add a session name first");
    return;
  }

  draft.sessions.push({
    key: "",
    bodyKey: "",
    name: name.trim(),
    duration: Number(duration) || 90,
    phase,
    owner,
    type,
    order: draft.sessions.length,
  });

  draft.customSession.name = "";
  draft.customSession.duration = 90;
}

export function removeOnboardingSession(index) {
  const draft = state.ui.onboarding.draft;
  if (!draft) return;
  draft.sessions.splice(index, 1);
  draft.sessions.forEach((session, sessionIndex) => {
    session.order = sessionIndex;
  });
}

export function moveOnboardingSession(index, direction) {
  const draft = state.ui.onboarding.draft;
  if (!draft) return;
  const target = index + direction;
  if (target < 0 || target >= draft.sessions.length) return;
  const [session] = draft.sessions.splice(index, 1);
  draft.sessions.splice(target, 0, session);
  draft.sessions.forEach((item, sessionIndex) => {
    item.order = sessionIndex;
  });
}

export function createProjectFromOnboarding() {
  const draft = state.ui.onboarding.draft;
  if (!draft) return null;

  const error = validateDraft(draft);
  if (error) {
    toast(error, 4000);
    return null;
  }

  const project = createProjectFromDraft(draft);
  upsertProject(project);
  setActiveProject(project.id);
  setActorMode("pm", "pm");
  setScreen("workspace");
  setCalendarStartFromProject(project);
  resetSmartFillPreference(project);
  closeOnboarding();
  clearProjectError();
  return project;
}

export function openProject(projectId, { actor = "pm", mode = actor } = {}) {
  const project = getProjectById(state.projects, projectId);
  if (!project) return null;
  setActiveProject(project.id);
  setActorMode(actor, mode);
  setScreen("workspace");
  setCalendarStartFromProject(project);
  resetSmartFillPreference(project);
  return project;
}

export function backToProjects() {
  setScreen("projects");
  state.ui.sidebarOpen = false;
}

export function openSettings() {
  const project = getCurrentProjectOrToast();
  if (!project) return;
  state.ui.settings.open = true;
  ensureSettingsDraft(project);
}

export function closeSettings() {
  state.ui.settings.open = false;
  state.ui.settings.draft = null;
}

export function updateSettingsField(field, value) {
  const draft = state.ui.settings.draft;
  if (!draft) return;

  if (field.startsWith("newSession.")) {
    const key = field.split(".")[1];
    draft.newSession[key] = key === "duration" ? Number(value) || 90 : value;
    if (key === "phase" && !draft.newSession.owner) {
      draft.newSession.owner = value === "implementation" ? "is" : "pm";
    }
    return;
  }

  if (field === "invitees") {
    draft.invitees = value;
    return;
  }

  draft[field] = value;
}

export function addSettingsSession() {
  const draft = state.ui.settings.draft;
  if (!draft) return;
  const next = draft.newSession;
  if (!next.name.trim()) {
    toast("Add a session name first");
    return;
  }

  addCustomSession(draft, {
    key: "",
    bodyKey: "",
    name: next.name.trim(),
    duration: Number(next.duration) || 90,
    phase: next.phase,
    owner: next.owner || (next.phase === "implementation" ? "is" : "pm"),
    type: next.type || "external",
  });

  draft.newSession.name = "";
  draft.newSession.duration = 90;
}

export function removeSettingsSession(sessionId) {
  const draft = state.ui.settings.draft;
  if (!draft) return;
  removeSession(draft, sessionId);
}

export function moveSettingsSession(sessionId, direction) {
  const draft = state.ui.settings.draft;
  if (!draft) return;
  moveSession(draft, sessionId, direction);
}

export function saveSettingsDraft() {
  const project = getCurrentProjectOrToast();
  const draft = state.ui.settings.draft;
  if (!project || !draft) return { status: "failed", project: null };

  const validated = normalizeProject({
    ...project,
    ...draft,
  });
  const windowChanged =
    project.implementationStart !== validated.implementationStart || project.goLiveDate !== validated.goLiveDate;
  const affectedSessionIds = windowChanged ? detectAffectedWindowSessions(validated) : [];

  if (affectedSessionIds.length) {
    queueWindowChangeDialog(validated, affectedSessionIds);
    return {
      status: "confirm",
      project: null,
      affectedSessionIds,
    };
  }

  return {
    status: "saved",
    project: applySavedProject(validated),
    affectedSessionIds: [],
  };
}

export function confirmWindowChangeClear() {
  const { nextProject, affectedSessionIds } = state.ui.windowChangeDialog;
  if (!nextProject) return null;

  for (const sessionId of affectedSessionIds) {
    const found = findSession(nextProject, sessionId);
    if (found) {
      clearSessionScheduling(found.session, { preserveGraphEventId: false });
    }
  }

  nextProject.status = deriveProjectStatus(nextProject);
  state.ui.smartOpen = true;
  return applySavedProject(nextProject);
}

export function confirmWindowChangeKeep() {
  const { nextProject } = state.ui.windowChangeDialog;
  if (!nextProject) return null;
  nextProject.status = deriveProjectStatus(nextProject);
  return applySavedProject(nextProject);
}

export function setSessionDate(sessionId, value) {
  const project = getCurrentProjectOrToast();
  if (!project) return false;

  const found = findSession(project, sessionId);
  if (!found || !canEditSession(project, found.session, state.actor)) return false;
  if (!ensureFutureDate(value)) {
    toast("Cannot schedule in the past");
    return false;
  }

  if (value && !isDateWithinPhaseWindow(project, found.session, value)) {
    toast("That date falls outside the phase window", 4000);
    return false;
  }

  const nextValue = value || "";
  if (found.session.date === nextValue) return true;

  if (!nextValue) {
    clearSessionScheduling(found.session, { preserveGraphEventId: false });
  } else {
    found.session.date = nextValue;
    found.session.availabilityConflict = false;
    invalidateSessionInviteState(found.session);
  }

  touchProject(project);
  project.status = deriveProjectStatus(project);
  return true;
}

export function setSessionTime(sessionId, value) {
  const project = getCurrentProjectOrToast();
  if (!project) return false;

  const found = findSession(project, sessionId);
  if (!found || !canEditSession(project, found.session, state.actor)) return false;
  if (!found.session.date) {
    toast("Set a date first");
    return false;
  }

  if (found.session.time === value) return true;
  found.session.time = value || "";
  if (value) {
    found.session.availabilityConflict = false;
  }
  invalidateSessionInviteState(found.session);
  touchProject(project);
  project.status = deriveProjectStatus(project);
  return true;
}

export function setSessionDuration(sessionId, value) {
  const project = getCurrentProjectOrToast();
  if (!project) return false;

  const found = findSession(project, sessionId);
  if (!found || !canEditSession(project, found.session, state.actor)) return false;

  const nextDuration = Number(value) || found.session.duration;
  if (found.session.duration === nextDuration) return true;
  found.session.duration = nextDuration;
  invalidateSessionInviteState(found.session);
  touchProject(project);
  return true;
}

export function unscheduleSession(sessionId) {
  const project = getCurrentProjectOrToast();
  if (!project) return false;

  const found = findSession(project, sessionId);
  if (!found || !canEditSession(project, found.session, state.actor)) return false;
  clearSessionScheduling(found.session, { preserveGraphEventId: false });
  touchProject(project);
  project.status = deriveProjectStatus(project);
  return true;
}

export function removeActiveSession(sessionId) {
  const project = getCurrentProjectOrToast();
  if (!project || state.actor !== "pm") return false;
  removeSession(project, sessionId);
  return true;
}

export function moveActiveSession(sessionId, direction) {
  const project = getCurrentProjectOrToast();
  if (!project || state.actor !== "pm") return false;
  moveSession(project, sessionId, direction);
  return true;
}

export function toggleSmart() {
  state.ui.smartOpen = !state.ui.smartOpen;
}

export function setSmartStart(value) {
  state.ui.smartStart = value || "";
}

export function setSmartPreference(value) {
  state.ui.smartPreference = normalizeSmartFillPreference(value);
}

export function toggleActiveDay(day) {
  if (state.ui.activeDays.has(day)) {
    state.ui.activeDays.delete(day);
  } else {
    state.ui.activeDays.add(day);
  }
}

export function setDayPreset(days) {
  state.ui.activeDays = new Set(days);
}

export function applySmartFill() {
  const project = getCurrentProjectOrToast();
  if (!project) return null;
  if (!state.ui.smartStart) {
    toast("Pick a start date");
    return null;
  }
  if (!state.ui.activeDays.size) {
    toast("Select at least one day");
    return null;
  }

  const result = {
    datedCount: 0,
    timedCount: 0,
    availabilityCount: 0,
    unplacedCount: 0,
    pass2Skipped: false,
    pass2SkipReason: "",
    unplacedSessionIds: [],
    availabilitySessionIds: [],
  };

  const undatedSessions = getEditableSessions(project, state.actor)
    .filter((session) => !session.date)
    .sort(compareSessions);

  for (const phaseKey of PHASE_ORDER) {
    const phaseSessions = undatedSessions.filter((session) => session.phase === phaseKey);
    if (!phaseSessions.length) continue;

    const distribution = distributePhaseDates(project, phaseKey, phaseSessions, state.ui.smartStart);
    for (const [session, dateString] of distribution.placed) {
      applySessionDate(session, dateString);
      result.datedCount += 1;
    }
    if (distribution.unplaced.length) {
      result.unplacedSessionIds.push(...distribution.unplaced.map((session) => session.id));
      result.unplacedCount += distribution.unplaced.length;
    }
  }

  const availabilityState = getSmartAvailabilityState(project, state.actor);
  if (!availabilityState.ready) {
    result.pass2Skipped = true;
    result.pass2SkipReason = availabilityState.reason;
  } else {
    const pendingAssignments = new Map();
    const candidates = getEditableSessions(project, state.actor)
      .filter((session) => session.date && !session.time)
      .sort(compareDatedSessions);

    for (const session of candidates) {
      const intervals = getTimedIntervalsForDate(project, state.actor, session.date, session.id, pendingAssignments);
      const slot = findOpenSlot(session.duration, intervals, normalizeSmartFillPreference(state.ui.smartPreference));
      if (slot) {
        session.time = slot;
        session.availabilityConflict = false;
        pendingAssignments.set(session.id, slot);
        invalidateSessionInviteState(session);
        result.timedCount += 1;
      } else {
        session.availabilityConflict = true;
        result.availabilitySessionIds.push(session.id);
      }
    }

    result.availabilityCount = result.availabilitySessionIds.length;
  }

  if (!result.datedCount && !result.timedCount && !result.availabilityCount && !result.unplacedCount) {
    return result;
  }

  touchProject(project);
  project.status = deriveProjectStatus(project);
  return result;
}

export function dropOnDate(sessionId, dateString) {
  return setSessionDate(sessionId, dateString);
}

export function calShift(direction) {
  if (!state.calStart) {
    state.calStart = mondayOf(new Date());
  }
  state.calStart = mondayOf(new Date(state.calStart.getTime() + direction * 7 * 86400000));
}

export function calToday() {
  state.calStart = mondayOf(new Date());
}

export function readyForHandoff(project = getActiveProject()) {
  return Boolean(project && projectHasImplementationReady(project));
}

export function pushableCount(project = getActiveProject(), actor = state.actor) {
  return getPushableSessions(project, actor).length;
}

export function visibleSessions(project = getActiveProject()) {
  return getAllSessions(project || {});
}

export function getReviewableConflictCount(project = getActiveProject(), actor = state.actor) {
  return getConflictReviewSessions(project, actor).length;
}
