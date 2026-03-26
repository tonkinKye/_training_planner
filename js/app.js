import { closeModal, fmt12, mondayOf, TIME_SLOTS } from "./utils.js";
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
  loadExamples,
  loadFromJSON,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDrop,
  onEventDragStart,
  onPoolDragStart,
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
  select.innerHTML = TIME_SLOTS.map(
    (value) =>
      `<option value="${value}"${value === selectedValue ? " selected" : ""}>${fmt12(value)}</option>`
  ).join("");
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

function exposeGlobals() {
  Object.assign(window, {
    addSession,
    applyAllTimes,
    applySmartFill,
    calShift,
    calToday,
    clearDates,
    closeModal,
    closeSidebar,
    doImport,
    exportSchedule,
    importSchedule: openImportModal,
    loadExamples,
    loadFromJSON,
    onDragEnd,
    onDragLeave,
    onDragOver,
    onDrop,
    onEventDragStart,
    onPoolDragStart,
    openOutlook,
    openSidebar,
    pushToCalendar,
    removeSession,
    setDate,
    setDayPreset,
    setDuration,
    setTime,
    sortByDate,
    switchMobileTab,
    toggleAuth,
    toggleSmart,
    unschedule,
  });
}

function init() {
  buildTimeSelect("globalTime", "09:00");
  initDayToggles();
  restoreStorage();
  syncNewSessionDurationWithGlobal();
  bindListeners();
  exposeGlobals();
  state.calStart = mondayOf(new Date());
  render();
  bootstrapMsal();

  if (window.innerWidth <= 768 && mobileActiveTab !== "calendar") {
    switchMobileTab("schedule");
  }
}

init();
