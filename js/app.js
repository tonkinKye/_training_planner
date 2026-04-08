import { closeModal, getTimeOptionsHTML, mondayOf } from "./utils.js";
import { bootstrapMsal, pushToCalendar, toggleAuth } from "./m365.js";
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

    removeSession: (el) => removeSession(el.dataset.id),
    pushToCalendar: (el) => pushToCalendar(el.dataset.id),
    openOutlook: (el) => openOutlook(el.dataset.id),
    unschedule: (el) => unschedule(el.dataset.id),

    calShift: (el) => calShift(Number(el.dataset.dir)),
    closeModal: (el) => closeModal(el.dataset.modal),
    switchMobileTab: (el) => switchMobileTab(el.dataset.tab),
    setDayPreset: (el) => setDayPreset(el.dataset.days.split(",").map(Number)),
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const handler = clickActions[el.dataset.action];
    if (handler) handler(el);
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
    const el = e.target.closest("[data-drop]");
    if (!el) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drag-over");
  });

  document.addEventListener("dragleave", (e) => {
    const el = e.target.closest("[data-drop]");
    if (el) el.classList.remove("drag-over");
  });

  document.addEventListener("drop", (e) => {
    const el = e.target.closest("[data-drop]");
    if (!el) return;
    e.preventDefault();
    el.classList.remove("drag-over");
    dropOnDate(el.dataset.date);
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
