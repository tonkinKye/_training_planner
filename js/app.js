import { closeModal, getTimeOptionsHTML, mondayOf, pad, toast } from "./utils.js";
import { getConflicts } from "./conflicts.js";
import {
  closeDayView,
  confirmConflict,
  openDayView,
  shiftDayView,
  navigateConflict,
  pushAllScheduled,
  renderDayViewGrid,
  startConflictReview,
} from "./dayview.js";
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
      if (event.target !== element) return;
      if (element.id === "dayViewModal") {
        closeDayView();
        return;
      }
      element.classList.remove("open");
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
      if (count) {
        toast(`${count} session${count > 1 ? "s" : ""} with conflicts`, 4000);
      } else {
        toast("No conflicts found", 4000);
      }
    },
    reviewConflicts: () => {
      startConflictReview();
    },

    removeSession: (el) => {
      removeSession(el.dataset.id);
      renderDayViewGrid();
    },
    pushToCalendar: (el) => pushToCalendar(el.dataset.id),
    openOutlook: (el) => openOutlook(el.dataset.id),
    unschedule: (el) => {
      unschedule(el.dataset.id);
      renderDayViewGrid({ focusActive: true });
    },

    openDayView: (el) => openDayView(el.dataset.date),
    closeDayView: () => closeDayView(),
    shiftDayView: (el) => shiftDayView(Number(el.dataset.dir)),
    navigateConflict: (el) => navigateConflict(Number(el.dataset.dir)),
    confirmConflict: () => confirmConflict(),
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
    if (action === "setDate") {
      setDate(id, el.value);
      renderDayViewGrid({ focusActive: true });
    } else if (action === "setTime") {
      setTime(id, el.value);
      renderDayViewGrid({ focusActive: true });
    } else if (action === "setDuration") {
      setDuration(id, el.value);
      renderDayViewGrid({ focusActive: true });
    }
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
    clearDvIndicator();
  });

  function dvSlotFromEvent(e, col) {
    const rect = col.getBoundingClientRect();
    const relY = e.clientY - rect.top - 32;
    return Math.max(0, Math.min(21, Math.floor(relY / 28)));
  }

  function dvTimeFromSlot(slotIndex) {
    const minutes = 420 + slotIndex * 30;
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }

  let activeDvIndicator = null;

  function clearDvIndicator() {
    if (activeDvIndicator) {
      activeDvIndicator.remove();
      activeDvIndicator = null;
    }
  }

  document.addEventListener("dragover", (e) => {
    const calEl = e.target.closest("[data-drop]");
    if (calEl) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      calEl.classList.add("drag-over");
      return;
    }

    const dvEl = e.target.closest("[data-drop-dv]");
    if (dvEl) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const slot = dvSlotFromEvent(e, dvEl);
      const top = 32 + slot * 28;

      if (!activeDvIndicator || activeDvIndicator.parentElement !== dvEl) {
        clearDvIndicator();
        activeDvIndicator = document.createElement("div");
        activeDvIndicator.className = "dv-drop-indicator";
        dvEl.appendChild(activeDvIndicator);
      }
      activeDvIndicator.style.top = `${top}px`;
    }
  });

  document.addEventListener("dragleave", (e) => {
    const calEl = e.target.closest("[data-drop]");
    if (calEl) calEl.classList.remove("drag-over");

    const dvEl = e.target.closest("[data-drop-dv]");
    if (dvEl && !dvEl.contains(e.relatedTarget)) {
      clearDvIndicator();
    }
  });

  document.addEventListener("drop", (e) => {
    clearDvIndicator();

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
      const now = new Date();
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const slotIndex = dvSlotFromEvent(e, dvDrop);
      const time = dvTimeFromSlot(slotIndex);
      if (dvDrop.dataset.date < today || (dvDrop.dataset.date === today && time < `${pad(now.getHours())}:${pad(now.getMinutes())}`)) {
        toast("Cannot schedule in the past");
        state.dragData = null;
        return;
      }
      const sessionId = state.dragData.sessionId;
      state.dragData = null;
      setDate(sessionId, dvDrop.dataset.date);
      setTime(sessionId, time);
      renderDayViewGrid({ focusActive: true });
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
