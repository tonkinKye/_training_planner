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
  getEditableSessions,
  getProjectById,
  getProjectDateRange,
  getPushableSessions,
  isDateWithinPhaseWindow,
  moveSession,
  normalizeProject,
  projectHasImplementationReady,
  removeSession,
  touchProject,
} from "./projects.js";
import { getTemplateReviewJSON, getTemplateSessions } from "./session-templates.js";
import { mondayOf, parseDate, toDateStr, toast } from "./utils.js";

const DEFAULT_START_TIME = "09:00";

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

function nextValidDate(cursor, project, session) {
  const windowMin = session.phase === "setup" ? "" : "";
  const today = getTodayString();
  let probe = parseDate(cursor < today ? today : cursor);

  while (probe.getFullYear() < 2100) {
    const dateString = toDateStr(probe);
    const day = probe.getDay();
    if (state.ui.activeDays.has(day) && isDateWithinPhaseWindow(project, session, dateString)) {
      return dateString;
    }
    probe.setDate(probe.getDate() + 1);
  }

  return "";
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
  if (!project || !draft) return null;

  const validated = normalizeProject({
    ...project,
    ...draft,
  });
  upsertProject(validated);
  setActiveProject(validated.id);
  closeSettings();
  return validated;
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

  found.session.date = nextValue;
  if (!nextValue) {
    found.session.time = "";
    invalidateSessionInviteState(found.session, { preserveGraphEventId: false });
  } else {
    if (!found.session.time) {
      found.session.time = DEFAULT_START_TIME;
    }
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
  invalidateSessionInviteState(found.session);
  touchProject(project);
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
  found.session.date = "";
  found.session.time = "";
  invalidateSessionInviteState(found.session, { preserveGraphEventId: false });
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
  if (!project) return false;
  if (!state.ui.smartStart) {
    toast("Pick a start date");
    return false;
  }
  if (!state.ui.activeDays.size) {
    toast("Select at least one day");
    return false;
  }

  let cursor = state.ui.smartStart;
  let updated = 0;
  const sessions = getEditableSessions(project, state.actor)
    .filter((session) => !session.date)
    .sort((left, right) => {
      if (left.phase !== right.phase) {
        const phaseOrder = ["setup", "implementation", "hypercare"];
        return phaseOrder.indexOf(left.phase) - phaseOrder.indexOf(right.phase);
      }
      return left.order - right.order;
    });

  for (const session of sessions) {
    const nextDate = nextValidDate(cursor, project, session);
    if (!nextDate) continue;
    session.date = nextDate;
    session.time = session.time || DEFAULT_START_TIME;
    invalidateSessionInviteState(session);
    updated += 1;

    const nextCursor = parseDate(nextDate);
    nextCursor.setDate(nextCursor.getDate() + 1);
    cursor = toDateStr(nextCursor);
  }

  if (!updated) {
    toast("No additional sessions could be placed within the phase windows", 4000);
    return false;
  }

  touchProject(project);
  project.status = deriveProjectStatus(project);
  toast(`Placed ${updated} session${updated > 1 ? "s" : ""}`, 3500);
  return true;
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
