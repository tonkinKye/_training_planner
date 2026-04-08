import { closeModal, getTimeOptionsHTML, mondayOf, pad, toast } from "./utils.js";
import { getConflicts } from "./conflicts.js";
import { openDayView, shiftDayView, pushAllScheduled, renderDayViewGrid } from "./dayview.js";
import { bootstrapMsal, fetchCalendarEvents, pushToCalendar, toggleAuth } from "./m365.js";
import { openOutlook } from "./invites.js";
import { render, renderCal } from "./render.js";
import {
  addSession,
  applyAllTimes,
  applySmartFill,
  calShift,
  calToday,
  clearDates,
  dropOnDate,
  loadExamples,
  loadFromJSON,
  removeSession,
  setDate,
  setDayPreset,
  setDuration,
  setTime,
  sortByDate,
  toggleActiveDay,
  toggleSmart,
  unschedule,
} from "./scheduler.js";
import {
  doImport,
  exportSchedule,
  invalidateAllInviteState,
  openImportModal,
  restoreStorage,
  saveState,
  state,
} from "./state.js";

let mobileActiveTab = "schedule";
let resizeTimer = null;

function buildTimeSelect(id, selectedValue) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = getTimeOptionsHTML(selectedValue);
}

function syncNewSessionDurationWithGlobal() {
  const globalDuration = document.getElementById("globalDuration");
  const newDuration = document.getElementById("newDur");
  if (!globalDuration || !newDuration) return;
  newDuration.value = globalDuration.value || "90";
}

function initDayToggles() {
  document.querySelectorAll(".dt").forEach((button) => {
    const day = Number(button.dataset.day);
    if (state.activeDays.has(day)) button.classList.add("on");
    button.addEventListener("click", () => toggleActiveDay(day, button));
  });
}

function handleFormChange(id) {
  const inviteAffectingFields = new Set([
    "globalLocation",
    "globalOrganiser",
    "globalEmail",
    "globalInvitees",
    "globalClient",
  ]);

  if (id === "globalDuration") {
    syncNewSessionDurationWithGlobal();
    saveState();
    return;
  }

  // globalTime does not invalidate invite state — it only affects future
  // auto-population of new rows, not existing per-row times. Use "Apply
  // Time to All" (applyAllTimes) to change existing rows, which does
  // invalidate.
  if (inviteAffectingFields.has(id)) {
    invalidateAllInviteState();
  }

  saveState();
  render();
}

function bindListeners() {
  [
    "globalTime",
    "globalDuration",
    "globalLocation",
    "globalOrganiser",
    "globalEmail",
    "globalInvitees",
    "globalClient",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => handleFormChange(id));
  });

  document.getElementById("newName")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addSession();
  });

  document.querySelectorAll(".modal-overlay").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target === element) element.classList.remove("open");
    });
  });

  document.querySelector(".sidebar")?.addEventListener("click", (event) => {
    if (
      window.innerWidth <= 768 &&
      (event.target.classList.contains("btn-primary") || event.target.classList.contains("btn-outline"))
    ) {
      window.setTimeout(closeSidebar, 300);
    }
  });

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => renderCal(), 200);
  });
}

export function openSidebar() {
  document.querySelector(".sidebar")?.classList.add("open");
  document.getElementById("drawerOverlay")?.classList.add("open");
  document.body.style.overflow = "hidden";
}

export function closeSidebar() {
  document.querySelector(".sidebar")?.classList.remove("open");
  document.getElementById("drawerOverlay")?.classList.remove("open");
  document.body.style.overflow = "";
}

export function switchMobileTab(tab) {
  mobileActiveTab = tab;
  document.querySelectorAll(".mobile-tab").forEach((button, index) => {
    button.classList.toggle(
      "active",
      (index === 0 && tab === "schedule") || (index === 1 && tab === "calendar")
    );
  });

  const panel = document.querySelector(".panel");
  const calPanel = document.querySelector(".cal-panel");
  if (!panel || !calPanel) return;

  if (tab === "schedule") {
    panel.classList.remove("mob-hidden");
    calPanel.classList.add("mob-hidden");
  } else {
    panel.classList.add("mob-hidden");
    calPanel.classList.remove("mob-hidden");
    renderCal();
  }
}

function setupEventDelegation() {
  const clickActions = {
    addSession: () => addSession(),
    applyAllTimes: () => applyAllTimes(),
    applySmartFill: () => applySmartFill(),
    calToday: () => calToday(),
    clearDates: () => clearDates(),
    closeSidebar: () => closeSidebar(),
    doImport: () => { if (doImport()) render(); },
    exportSchedule: () => exportSchedule(),
    loadExamples: () => loadExamples(),
    loadFromJSON: () => loadFromJSON(),
    openImportModal: () => openImportModal(),
    openSidebar: () => openSidebar(),
    sortByDate: () => sortByDate(),
    toggleAuth: () => toggleAuth(),
    toggleSmart: () => toggleSmart(),
    checkConflicts: async () => {
      toast("Fetching calendar\u2026");
      await fetchCalendarEvents();
      render();
      const conflicts = getConflicts();
      const count = conflicts.size;
      toast(count ? `${count} session${count > 1 ? "s" : ""} with conflicts` : "No conflicts found", 4000);
    },

    removeSession: (el) => removeSession(el.dataset.id),
    pushToCalendar: (el) => pushToCalendar(el.dataset.id),
    openOutlook: (el) => openOutlook(el.dataset.id),
    unschedule: (el) => unschedule(el.dataset.id),

    openDayView: (el) => openDayView(el.dataset.date),
    shiftDayView: (el) => shiftDayView(Number(el.dataset.dir)),
    pushAllScheduled: () => pushAllScheduled(),

    calShift: (el) => calShift(Number(el.dataset.dir)),
    closeModal: (el) => closeModal(el.dataset.modal),
    switchMobileTab: (el) => switchMobileTab(el.dataset.tab),
    setDayPreset: (el) => setDayPreset(el.dataset.days.split(",").map(Number)),
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const handler = clickActions[el.dataset.action];
    if (!handler) {
      console.warn("Unknown data-action:", el.dataset.action);
      return;
    }
    try {
      const result = handler(el);
      if (result instanceof Promise) result.catch((err) => console.error(`Async action "${el.dataset.action}" failed:`, err));
    } catch (err) {
      console.error(`Action "${el.dataset.action}" failed:`, err);
    }
  });

  document.addEventListener("change", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const { action, id } = el.dataset;
    if (action === "setDate") setDate(id, el.value);
    else if (action === "setTime") setTime(id, el.value);
    else if (action === "setDuration") setDuration(id, el.value);
  });

  document.addEventListener("dragstart", (e) => {
    const el = e.target.closest("[data-drag]");
    if (!el) return;
    el.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    state.dragData = { type: el.dataset.drag, sessionId: el.dataset.id };
  });

  document.addEventListener("dragend", (e) => {
    const el = e.target.closest("[data-drag]");
    if (el) el.classList.remove("dragging");
    state.dragData = null;
  });

  document.addEventListener("dragover", (e) => {
    const el = e.target.closest("[data-drop], [data-drop-dv]");
    if (!el) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drag-over");
  });

  document.addEventListener("dragleave", (e) => {
    const el = e.target.closest("[data-drop], [data-drop-dv]");
    if (el) el.classList.remove("drag-over");
  });

  document.addEventListener("drop", (e) => {
    const calDrop = e.target.closest("[data-drop]");
    if (calDrop) {
      e.preventDefault();
      calDrop.classList.remove("drag-over");
      dropOnDate(calDrop.dataset.date);
      return;
    }

    const dvDrop = e.target.closest("[data-drop-dv]");
    if (dvDrop && state.dragData) {
      e.preventDefault();
      dvDrop.classList.remove("drag-over");
      const rect = dvDrop.getBoundingClientRect();
      const hdrHeight = 32;
      const relY = e.clientY - rect.top - hdrHeight;
      const slotIndex = Math.max(0, Math.min(21, Math.floor(relY / 28)));
      const minutes = 420 + slotIndex * 30;
      const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
      const sessionId = state.dragData.sessionId;
      state.dragData = null;
      setDate(sessionId, dvDrop.dataset.date);
      setTime(sessionId, time);
      renderDayViewGrid();
    }
  });
}

function init() {
  buildTimeSelect("globalTime", "09:00");
  initDayToggles();
  restoreStorage();
  syncNewSessionDurationWithGlobal();
  bindListeners();
  setupEventDelegation();
  state.calStart = mondayOf(new Date());
  render();
  bootstrapMsal();

  if (window.innerWidth <= 768 && mobileActiveTab !== "calendar") {
    switchMobileTab("schedule");
  }
}

init();
