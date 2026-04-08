import { closeModal, downloadBlob, toast } from "./utils.js";

const STORAGE_KEY = "tp_v3";

const FORM_DEFAULTS = {
  globalTime: "09:00",
  globalDuration: "90",
  globalLocation: "",
  globalOrganiser: "",
  globalEmail: "",
  globalInvitees: "",
  globalClient: "",
};

export const state = {
  sessions: [],
  schedule: [],
  activeDays: new Set([1, 2, 3, 4, 5]),
  smartOpen: false,
  calStart: null,
  dragData: null,
  graphAccount: null,
  calendarEvents: [],
};

let storageWarningShown = false;

export function uid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function calUID() {
  return `${uid()}@trainingplanner.local`;
}

export function createScheduleRow(sessionId) {
  return {
    sessionId,
    date: "",
    time: "",
    outlookActioned: false,
    graphActioned: false,
    graphEventId: "",
  };
}

function normalizeSession(session) {
  return {
    ...session,
    duration: Number(session?.duration) || Number(FORM_DEFAULTS.globalDuration),
    seq: Number(session?.seq) || 0,
    calUID: session?.calUID || calUID(),
  };
}

function normalizeScheduleRow(row) {
  const graphEventId = row?.graphEventId || "";
  const legacyActioned = Boolean(row?.actioned);

  return {
    sessionId: row?.sessionId || "",
    date: row?.date || "",
    time: row?.time || "",
    outlookActioned: Boolean(row?.outlookActioned || (legacyActioned && !graphEventId)),
    graphActioned: Boolean(row?.graphActioned || (legacyActioned && Boolean(graphEventId))),
    graphEventId,
  };
}

function setSavedStatus(message) {
  const element = document.getElementById("stSaved");
  if (element) element.textContent = message;
}

export function getPlannerFormData() {
  return {
    globalTime: document.getElementById("globalTime")?.value || FORM_DEFAULTS.globalTime,
    globalDuration:
      document.getElementById("globalDuration")?.value || FORM_DEFAULTS.globalDuration,
    globalLocation: document.getElementById("globalLocation")?.value || "",
    globalOrganiser: document.getElementById("globalOrganiser")?.value || "",
    globalEmail: document.getElementById("globalEmail")?.value || "",
    globalInvitees: document.getElementById("globalInvitees")?.value || "",
    globalClient: document.getElementById("globalClient")?.value || "",
  };
}

export function applyPlannerFormData(data = {}) {
  for (const [id, defaultValue] of Object.entries(FORM_DEFAULTS)) {
    const element = document.getElementById(id);
    if (!element) continue;
    if (Object.prototype.hasOwnProperty.call(data, id)) {
      element.value = data[id] ?? defaultValue;
    } else {
      element.value = defaultValue;
    }
  }
}

function ensureScheduledRowsHaveTime() {
  const defaultTime = document.getElementById("globalTime")?.value || FORM_DEFAULTS.globalTime;
  for (const row of state.schedule) {
    if (row.date && !row.time) row.time = defaultTime;
  }
}

export function syncScheduleRows() {
  const rowMap = new Map(state.schedule.map((row) => [row.sessionId, row]));
  state.schedule = state.sessions.map((session) => {
    const existing = rowMap.get(session.id);
    return existing ? normalizeScheduleRow(existing) : createScheduleRow(session.id);
  });
}

export function getSession(sessionId) {
  return state.sessions.find((session) => session.id === sessionId) || null;
}

export function getScheduleRow(sessionId) {
  return state.schedule.find((row) => row.sessionId === sessionId) || null;
}

export function invalidateRowInviteState(row, { preserveGraphEventId = true } = {}) {
  if (!row) return;
  row.outlookActioned = false;
  row.graphActioned = false;
  if (!preserveGraphEventId) row.graphEventId = "";
}

export function invalidateInviteStateForSession(sessionId, options) {
  invalidateRowInviteState(getScheduleRow(sessionId), options);
}

export function invalidateAllInviteState(options) {
  state.schedule.forEach((row) => invalidateRowInviteState(row, options));
}

export function setGraphAccount(account) {
  state.graphAccount = account || null;
}

export function clearCalendarEvents() {
  state.calendarEvents = [];
}

function serializeState() {
  return JSON.stringify({
    sessions: state.sessions,
    schedule: state.schedule,
    ...getPlannerFormData(),
  });
}

export function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState());
    setSavedStatus(`Saved ${new Date().toLocaleTimeString()}`);
    storageWarningShown = false;
    return true;
  } catch (error) {
    console.error("Local save failed:", error);
    setSavedStatus("Save failed");
    if (!storageWarningShown) {
      toast("Could not save locally. Browser storage may be unavailable.", 5000);
      storageWarningShown = true;
    }
    return false;
  }
}

export function restoreStorage() {
  setSavedStatus("No local save yet");

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const data = JSON.parse(raw);
    state.sessions = (data.sessions || []).map(normalizeSession);
    state.schedule = (data.schedule || []).map(normalizeScheduleRow);
    syncScheduleRows();
    applyPlannerFormData(data);
    ensureScheduledRowsHaveTime();
    setSavedStatus("Restored from storage");
    storageWarningShown = false;
    return true;
  } catch (error) {
    console.error("Local restore failed:", error);
    setSavedStatus("Restore failed");
    toast("Saved data could not be restored", 5000);
    return false;
  }
}

export function exportSchedule() {
  const payload = {
    sessions: state.sessions,
    schedule: state.schedule,
    ...getPlannerFormData(),
    exported: new Date().toISOString(),
    note: "Graph event IDs are preserved so imported schedules can update existing M365 events.",
  };

  downloadBlob(JSON.stringify(payload, null, 2), "training-schedule.json", "application/json");
  toast("Schedule exported");
}

export function openImportModal() {
  const textarea = document.getElementById("importData");
  if (textarea) textarea.value = "";
  document.getElementById("importModal")?.classList.add("open");
}

function isValidSession(session) {
  return session && typeof session.name === "string" && session.name.trim() !== "";
}

export function doImport() {
  try {
    const raw = document.getElementById("importData")?.value || "";
    const data = JSON.parse(raw);

    const rawSessions = data.sessions || [];
    const validSessions = rawSessions.filter(isValidSession);
    const skipped = rawSessions.length - validSessions.length;
    if (skipped) console.warn(`Import skipped ${skipped} session(s) with missing or empty name.`);

    state.sessions = validSessions.map(normalizeSession);
    state.schedule = (data.schedule || []).map(normalizeScheduleRow);
    syncScheduleRows();
    applyPlannerFormData(data);
    ensureScheduledRowsHaveTime();
    saveState();
    closeModal("importModal");
    toast(skipped ? `Imported (${skipped} invalid session${skipped > 1 ? "s" : ""} skipped)` : "Schedule imported");
    return true;
  } catch (error) {
    console.error("Schedule import failed:", error);
    toast("Invalid JSON");
    return false;
  }
}
