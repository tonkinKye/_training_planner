import { createCalendarAvailabilityState } from "./calendar-sources.js";

export const STORAGE_EXCEPTION_NOTE = "MSAL may use sessionStorage; application data must not.";
export const SENTINEL_SUBJECT = "TP-ProjectIndex";
export const SENTINEL_SCHEMA_ID = "com.fishbowl.trainingplanner.v1";
export const APP_SCHEMA_VERSION = 1;
export const DEEP_LINK_LIMIT = 2000; // Outlook Desktop URL limit raised to 8192 in supported M365 builds; 2000 is conservative for client variability

function createOnboardingState() {
  return {
    open: false,
    step: 0,
    draft: null,
    templateReviewJSON: "",
  };
}

function createSettingsState() {
  return {
    open: false,
    draft: null,
  };
}

function createCloseDialogState() {
  return {
    open: false,
    projectId: "",
    projectName: "",
  };
}

function createDeleteDialogState() {
  return {
    open: false,
    projectId: "",
    projectName: "",
  };
}

function createShiftDialogState() {
  return {
    open: false,
    sessionId: "",
    newDate: "",
    phaseKey: "",
  };
}

function createWindowChangeDialogState() {
  return {
    open: false,
    nextProject: null,
    affectedSessionIds: [],
    affectedCount: 0,
  };
}

function createProjectErrorState() {
  return {
    open: false,
    message: "",
    details: "",
  };
}

function createLastHandoffState() {
  return {
    url: "",
    length: 0,
    delegateUsed: false,
    eventId: "",
  };
}

export const state = {
  graphAccount: null,
  authStatus: "idle",
  authError: "",
  projects: [],
  activeProjectId: "",
  actor: "pm",
  mode: "pm",
  sentinel: {
    status: "idle",
    eventId: "",
    extensionId: "",
    seriesMasterId: "",
    error: "",
    malformed: false,
    loadedAt: "",
  },
  deepLink: {
    encoded: "",
    payload: null,
    length: 0,
  },
  ui: {
    screen: "auth",
    sidebarOpen: false,
    smartOpen: false,
    smartStart: "",
    smartPreference: "none",
    activeDays: new Set([1, 2, 3, 4, 5]),
    onboarding: createOnboardingState(),
    settings: createSettingsState(),
    windowChangeDialog: createWindowChangeDialogState(),
    shiftDialog: createShiftDialogState(),
    deleteDialog: createDeleteDialogState(),
    closeDialog: createCloseDialogState(),
    peopleQuery: "",
    peopleMatches: [],
    peopleStatus: "idle",
    peopleError: "",
    projectError: createProjectErrorState(),
    lastHandoff: createLastHandoffState(),
    showArchived: false,
    projectSearch: "",
    expandedPhaseSections: new Set(),
    expandedStageSections: new Set(),
  },
  calendarAvailability: createCalendarAvailabilityState(),
  calStart: null,
  calendarEvents: [],
  dragData: null,
};

export function uid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function getActiveProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null;
}

export function setGraphAccount(account) {
  state.graphAccount = account || null;
}

export function setScreen(screen) {
  state.ui.screen = screen;
}

export function setAuthStatus(status, error = "") {
  state.authStatus = status;
  state.authError = error;
}

export function setProjects(projects) {
  state.projects = [...projects];
}

export function setActiveProject(projectId) {
  state.activeProjectId = projectId || "";
}

export function upsertProject(project) {
  const index = state.projects.findIndex((candidate) => candidate.id === project.id);
  if (index >= 0) {
    state.projects.splice(index, 1, project);
  } else {
    state.projects.push(project);
  }
}

export function replaceProject(projectId, nextProject) {
  const index = state.projects.findIndex((project) => project.id === projectId);
  if (index >= 0) {
    state.projects.splice(index, 1, nextProject);
  }
}

export function removeProject(projectId) {
  state.projects = state.projects.filter((project) => project.id !== projectId);
  if (state.activeProjectId === projectId) {
    state.activeProjectId = state.projects[0]?.id || "";
  }
}

export function setActorMode(actor, mode = actor) {
  state.actor = actor;
  state.mode = mode;
}

export function setDeepLink(encoded, payload) {
  state.deepLink = {
    encoded: encoded || "",
    payload: payload || null,
    length: encoded ? encoded.length : 0,
  };
}

export function clearDeepLink() {
  state.deepLink = {
    encoded: "",
    payload: null,
    length: 0,
  };
}

export function setSentinelState(nextState) {
  state.sentinel = {
    ...state.sentinel,
    ...nextState,
  };
}

export function setCalendarEvents(events) {
  state.calendarEvents = Array.isArray(events) ? [...events] : [];
}

export function clearCalendarEvents() {
  state.calendarEvents = [];
}

export function setCalendarAvailability(nextState) {
  const current = createCalendarAvailabilityState(state.calendarAvailability);
  const mergedSources = {
    pm: {
      ...current.sources.pm,
      ...(nextState?.sources?.pm || {}),
    },
    is: {
      ...current.sources.is,
      ...(nextState?.sources?.is || {}),
    },
  };

  state.calendarAvailability = {
    ...current,
    ...(nextState || {}),
    warnings: Array.isArray(nextState?.warnings) ? [...nextState.warnings] : current.warnings,
    sources: mergedSources,
  };
}

export function resetCalendarAvailability(nextState = {}) {
  state.calendarAvailability = createCalendarAvailabilityState(nextState);
}

export function setProjectError(message, details = "") {
  state.ui.projectError = {
    open: true,
    message,
    details,
  };
}

export function clearProjectError() {
  state.ui.projectError = createProjectErrorState();
}

export function resetUIState() {
  state.ui.screen = state.graphAccount ? "projects" : "auth";
  state.ui.sidebarOpen = false;
  state.ui.smartOpen = false;
  state.ui.smartStart = "";
  state.ui.smartPreference = "none";
  state.ui.activeDays = new Set([1, 2, 3, 4, 5]);
  state.ui.onboarding = createOnboardingState();
  state.ui.settings = createSettingsState();
  state.ui.windowChangeDialog = createWindowChangeDialogState();
  state.ui.shiftDialog = createShiftDialogState();
  state.ui.deleteDialog = createDeleteDialogState();
  state.ui.closeDialog = createCloseDialogState();
  state.ui.peopleQuery = "";
  state.ui.peopleMatches = [];
  state.ui.peopleStatus = "idle";
  state.ui.peopleError = "";
  state.ui.projectError = createProjectErrorState();
  state.ui.lastHandoff = createLastHandoffState();
  state.ui.showArchived = false;
  state.ui.projectSearch = "";
  state.ui.expandedPhaseSections = new Set();
  state.ui.expandedStageSections = new Set();
}

export function resetAppState({ preserveAuth = false } = {}) {
  const preservedAccount = preserveAuth ? state.graphAccount : null;
  const preservedAuthStatus = preserveAuth ? state.authStatus : "idle";

  state.graphAccount = preservedAccount;
  state.authStatus = preservedAuthStatus;
  state.authError = "";
  state.projects = [];
  state.activeProjectId = "";
  state.actor = "pm";
  state.mode = "pm";
  state.sentinel = {
    status: "idle",
    eventId: "",
    extensionId: "",
    seriesMasterId: "",
    error: "",
    malformed: false,
    loadedAt: "",
  };
  state.deepLink = {
    encoded: "",
    payload: null,
    length: 0,
  };
  state.calendarAvailability = createCalendarAvailabilityState();
  resetUIState();
  state.calStart = null;
  state.calendarEvents = [];
  state.dragData = null;
}
