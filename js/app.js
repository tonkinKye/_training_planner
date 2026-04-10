import { getConflicts } from "./conflicts.js";
import {
  closeDayView,
  confirmConflict,
  navigateConflict,
  openDayView,
  runPushWorkflow,
  shiftDayView,
  startConflictReview,
} from "./dayview.js";
import { buildClientPlanHTML } from "./clientplan.js";
import { decodeProjectParam } from "./deeplink.js";
import { openOutlook } from "./invites.js";
import {
  applyDeepLinkProject,
  bootstrapMsal,
  closeProject as closeProjectWorkflow,
  createHandoffEvent,
  deleteFutureProjectEvents,
  fetchCalendarEvents,
  persistActiveProjects,
  pushSessionToCalendar,
  resetSentinel,
  searchPeople,
  toggleAuth,
} from "./m365.js";
import { render } from "./render.js";
import {
  addOnboardingSession,
  addSettingsSession,
  applySmartFill,
  backToProjects,
  calShift,
  calToday,
  closeOnboarding,
  closeSettings,
  createProjectFromOnboarding,
  dropOnDate,
  moveActiveSession,
  moveOnboardingSession,
  moveSettingsSession,
  nextOnboardingStep,
  openOnboarding,
  openProject,
  openSettings,
  prevOnboardingStep,
  removeActiveSession,
  removeOnboardingSession,
  removeSettingsSession,
  confirmShiftRemaining,
  confirmWindowChangeClear,
  confirmWindowChangeKeep,
  dismissShiftDialog,
  saveSettingsDraft,
  setDayPreset,
  setSessionDate,
  setSessionDuration,
  setSmartPreference,
  getSmartFillCoverageRange,
  setSessionTime,
  setSmartStart,
  toggleActiveDay,
  toggleOnboardingWorkingDay,
  toggleSettingsWorkingDay,
  toggleSmart,
  unscheduleSession,
  updateOnboardingField,
  updateSettingsField,
} from "./scheduler.js";
import { getAllSessions } from "./projects.js";
import { clearProjectError, getActiveProject, removeProject, setActorMode, setDeepLink, setProjectError, setScreen, state } from "./state.js";
import { downloadBlob, pad, toast, toDateStr } from "./utils.js";

function afterRender() {
  if (document.getElementById("dayViewModal")) {
    document.querySelector(".dv-day-col.active-conflict")?.scrollIntoView({ inline: "center", block: "nearest" });
  }
}

function rerender() {
  render();
  afterRender();
}

async function persistAndRender(shouldPersist = true) {
  if (shouldPersist) {
    await persistActiveProjects();
  }
  rerender();
}

async function handleDeepLinkIfPresent() {
  if (!state.deepLink.payload || !state.graphAccount) return;
  const payload = state.deepLink.payload;
  const hasEmbeddedProject =
    Boolean(payload?.c || payload?.pt || payload?.pm || payload?.pn || payload?.is || payload?.in) ||
    Array.isArray(payload?.impl);
  let project = null;

  if (hasEmbeddedProject) {
    try {
      project = await applyDeepLinkProject(payload);
      if (project?.id) {
        project = openProject(project.id, { actor: "is", mode: "is" }) || project;
      }
    } catch (error) {
      console.warn("Deep link payload apply failed, falling back to sentinel lookup:", error);
    }
  }

  if (!project && payload?.id) {
    project = openProject(payload.id, { actor: "is", mode: "is" });
  }

  if (!project) {
    setScreen("projects");
    setProjectError(
      "Could not load the handoff project.",
      `Project ${payload?.id || "unknown"} was not found in this calendar sentinel.`
    );
    return;
  }
  clearProjectError();
  await fetchCalendarEvents({ project });
}

async function refreshProjectContext() {
  const project = getActiveProject();
  if (!project) return;
  await fetchCalendarEvents({ project });
}

function readBindingTarget(binding) {
  const [scope, ...rest] = binding.split(".");
  return {
    scope,
    field: rest.join("."),
  };
}

function applyBinding(binding, value) {
  const { scope, field } = readBindingTarget(binding);
  if (scope === "onboarding") {
    updateOnboardingField(field, value);
    rerender();
    return;
  }
  if (scope === "settings") {
    updateSettingsField(field, value);
    rerender();
    return;
  }
  if (scope === "peopleQuery") {
    state.ui.peopleQuery = value;
    return;
  }
}

function dayViewSlotFromEvent(event, column) {
  const rect = column.getBoundingClientRect();
  const relativeY = event.clientY - rect.top - 96;
  return Math.max(0, Math.min(23, Math.floor(relativeY / 28)));
}

function timeFromSlot(slotIndex) {
  const minutes = 360 + slotIndex * 30;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function buildSmartFillToast(result) {
  if (!result) return "No additional sessions could be placed";

  if (!result.datedCount && !result.timedCount && !result.availabilityCount) {
    if (result.unplacedCount) {
      return `${result.unplacedCount} unplaced — phase window may be too tight.`;
    }
    return "No sessions were placed.";
  }

  const parts = [];
  if (result.datedCount) {
    parts.push(`${result.datedCount} session${result.datedCount > 1 ? "s" : ""} scheduled`);
  }
  if (result.timedCount) {
    parts.push(`${result.timedCount} time slot${result.timedCount > 1 ? "s" : ""} assigned`);
  }
  if (result.availabilityCount) {
    parts.push(`${result.availabilityCount} need manual time review`);
  }
  if (result.unplacedCount) {
    parts.push(`${result.unplacedCount} unplaced — phase window may be too tight`);
  }
  if (result.pass2Skipped && result.datedCount) {
    parts.push("availability not loaded, so times were not assigned");
  }
  return parts.join(", ");
}

async function actionHandlers(action, element) {
  switch (action) {
    case "toggleAuth":
      await toggleAuth();
      if (state.graphAccount) {
        await handleDeepLinkIfPresent();
      }
      rerender();
      return;
    case "openOnboarding":
      openOnboarding();
      rerender();
      return;
    case "closeOnboarding":
      closeOnboarding();
      rerender();
      return;
    case "nextOnboarding":
      nextOnboardingStep();
      rerender();
      return;
    case "prevOnboarding":
      prevOnboardingStep();
      rerender();
      return;
    case "createProject": {
      const project = createProjectFromOnboarding();
      if (!project) {
        rerender();
        return;
      }
      await persistAndRender(true);
      await fetchCalendarEvents({ project });
      rerender();
      return;
    }
    case "selectProject": {
      const project = openProject(element.dataset.id);
      rerender();
      if (project) {
        await fetchCalendarEvents({ project });
        rerender();
      }
      return;
    }
    case "backToProjects":
      backToProjects();
      rerender();
      return;
    case "openSettings":
      openSettings();
      rerender();
      return;
    case "closeSettings":
      closeSettings();
      rerender();
      return;
    case "saveSettings": {
      const outcome = saveSettingsDraft();
      if (outcome?.status === "saved" && outcome.project) {
        await persistAndRender(true);
        await fetchCalendarEvents({ project: outcome.project });
      } else {
        rerender();
      }
      return;
    }
    case "confirmWindowChangeClear": {
      const project = confirmWindowChangeClear();
      if (project) {
        await persistAndRender(true);
        await fetchCalendarEvents({ project });
        toast("Affected dates were cleared. Re-run Smart Fill to place them again.", 4500);
      } else {
        rerender();
      }
      return;
    }
    case "confirmWindowChangeKeep": {
      const project = confirmWindowChangeKeep();
      if (project) {
        await persistAndRender(true);
        await fetchCalendarEvents({ project });
        startConflictReview();
      } else {
        rerender();
      }
      return;
    }
    case "confirmShiftRemaining":
      if (confirmShiftRemaining()) {
        await persistAndRender(true);
      } else {
        rerender();
      }
      return;
    case "dismissShiftDialog":
      dismissShiftDialog();
      rerender();
      return;
    case "deleteProject":
      state.ui.deleteDialog = {
        open: true,
        projectId: element.dataset.id || "",
        projectName: element.dataset.name || "this project",
      };
      rerender();
      return;
    case "confirmDeleteProject": {
      const deleteId = state.ui.deleteDialog.projectId;
      state.ui.deleteDialog = { open: false, projectId: "", projectName: "" };
      if (deleteId) {
        removeProject(deleteId);
        setScreen("projects");
        await persistAndRender(true);
        toast("Project deleted", 3000);
      } else {
        rerender();
      }
      return;
    }
    case "dismissDeleteProject":
      state.ui.deleteDialog = { open: false, projectId: "", projectName: "" };
      rerender();
      return;
    case "closeProject":
      state.ui.closeDialog = {
        open: true,
        projectId: element.dataset.id || "",
        projectName: element.dataset.name || "this project",
      };
      rerender();
      return;
    case "confirmCloseProject": {
      const closeId = state.ui.closeDialog.projectId;
      state.ui.closeDialog = { open: false, projectId: "", projectName: "" };
      const projectToClose = state.projects.find((p) => p.id === closeId);
      if (projectToClose) {
        try {
          const result = await closeProjectWorkflow(projectToClose);
          setScreen("projects");
          rerender();
          toast(result.failed ? `Project closed. ${result.deleted} events removed, ${result.failed} could not be removed.` : "Project closed", 4000);
        } catch (error) {
          console.error("Close project failed:", error);
          toast(error.message || String(error), 5000);
          rerender();
        }
      } else {
        rerender();
      }
      return;
    }
    case "dismissCloseProject":
      state.ui.closeDialog = { open: false, projectId: "", projectName: "" };
      rerender();
      return;
    case "toggleArchived":
      state.ui.showArchived = !state.ui.showArchived;
      rerender();
      return;
    case "cleanUpCalendar": {
      const cleanupProject = getActiveProject();
      if (!cleanupProject) return;
      try {
        const result = await deleteFutureProjectEvents(cleanupProject);
        await persistAndRender(true);
        toast(result.deleted ? `${result.deleted} calendar events removed` : "No future events found", 3500);
      } catch (error) {
        console.error("Calendar cleanup failed:", error);
        toast(error.message || String(error), 5000);
      }
      return;
    }
    case "addOnboardingSession":
      addOnboardingSession();
      rerender();
      return;
    case "removeOnboardingSession":
      removeOnboardingSession(element.dataset.id);
      rerender();
      return;
    case "moveOnboardingSession":
      moveOnboardingSession(element.dataset.id, Number(element.dataset.dir));
      rerender();
      return;
    case "addSettingsSession":
      addSettingsSession();
      rerender();
      return;
    case "removeSettingsSession":
      removeSettingsSession(element.dataset.id);
      rerender();
      return;
    case "moveSettingsSession":
      moveSettingsSession(element.dataset.id, Number(element.dataset.dir));
      rerender();
      return;
    case "toggleSmart":
      toggleSmart();
      rerender();
      return;
    case "toggleOnboardingWorkingDay":
      toggleOnboardingWorkingDay(Number(element.dataset.day));
      rerender();
      return;
    case "toggleSettingsWorkingDay":
      toggleSettingsWorkingDay(Number(element.dataset.day));
      rerender();
      return;
    case "setSmartStart":
      setSmartStart(element.value);
      return;
    case "setSmartPreference":
      setSmartPreference(element.dataset.value || element.value);
      rerender();
      return;
    case "toggleActiveDay":
      toggleActiveDay(Number(element.dataset.day));
      rerender();
      return;
    case "setDayPreset":
      setDayPreset(element.dataset.days.split(",").map(Number));
      rerender();
      return;
    case "refreshSmartAvailability": {
      const project = getActiveProject();
      if (!project) {
        rerender();
        return;
      }
      const range = getSmartFillCoverageRange(project, state.actor);
      const pending = fetchCalendarEvents({ project, startDate: range.start, endDate: range.end });
      rerender();
      await pending;
      rerender();
      return;
    }
    case "applySmartFill":
      {
        const sfProject = getActiveProject();
        if (sfProject) {
          const sfRange = getSmartFillCoverageRange(sfProject, state.actor);
          const sfAvail = state.calendarAvailability;
          if (sfAvail.status !== "ready" || sfAvail.projectId !== sfProject.id || sfAvail.rangeStart > sfRange.start || sfAvail.rangeEnd < sfRange.end) {
            toast("Loading calendar availability...", 3000);
            rerender();
            await fetchCalendarEvents({ project: sfProject, startDate: sfRange.start, endDate: sfRange.end });
            rerender();
          }
        }
        const result = applySmartFill();
        if (!result) {
          rerender();
          return;
        }
        if (!result.datedCount && !result.timedCount && !result.availabilityCount && !result.unplacedCount && !result.rangeCount) {
          rerender();
          toast(buildSmartFillToast(result), 5000);
          return;
        }
        await persistAndRender(true);
        toast(buildSmartFillToast(result), 5000);
        return;
      }
    case "setSessionDate":
      if (setSessionDate(element.dataset.id, element.value)) {
        await persistAndRender(true);
      } else {
        rerender();
      }
      return;
    case "setSessionTime":
      if (setSessionTime(element.dataset.id, element.value)) {
        await persistAndRender(true);
      } else {
        rerender();
      }
      return;
    case "setSessionDuration":
      if (setSessionDuration(element.dataset.id, element.value)) {
        await persistAndRender(true);
      } else {
        rerender();
      }
      return;
    case "unscheduleSession":
      if (unscheduleSession(element.dataset.id)) {
        await persistAndRender(true);
      } else {
        rerender();
      }
      return;
    case "removeSession":
      if (removeActiveSession(element.dataset.id)) {
        await persistAndRender(true);
        toast("Session removed", 4500, {
          label: "Open Smart Fill",
          callback: () => {
            state.ui.smartOpen = true;
            rerender();
          },
        });
      } else {
        rerender();
      }
      return;
    case "moveSession":
      if (moveActiveSession(element.dataset.id, Number(element.dataset.dir))) {
        await persistAndRender(true);
      } else {
        rerender();
      }
      return;
    case "calShift":
      calShift(Number(element.dataset.dir));
      rerender();
      return;
    case "calToday":
      calToday();
      rerender();
      return;
    case "checkConflicts":
      await refreshProjectContext();
      rerender();
      toast(getConflicts({ project: getActiveProject(), actor: state.actor, scope: "review", blockingOnly: true }).size ? "Conflicts found" : "No conflicts found", 3500);
      return;
    case "reviewConflicts":
      await refreshProjectContext();
      startConflictReview();
      rerender();
      return;
    case "openDayView":
      openDayView(element.dataset.date || toDateStr(new Date()));
      rerender();
      return;
    case "closeDayView":
      closeDayView();
      rerender();
      return;
    case "shiftDayView":
      shiftDayView(Number(element.dataset.dir));
      rerender();
      return;
    case "navigateConflict":
      navigateConflict(Number(element.dataset.dir));
      rerender();
      return;
    case "confirmConflict":
      await confirmConflict();
      rerender();
      return;
    case "pushOwned":
      await refreshProjectContext();
      await runPushWorkflow();
      rerender();
      return;
    case "pushSession":
      await pushSessionToCalendar(element.dataset.id);
      rerender();
      return;
    case "openOutlook": {
      const opened = await openOutlook(element.dataset.id);
      if (opened) {
        await persistAndRender(true);
      } else {
        rerender();
      }
      return;
    }
    case "handoffToIs":
      try {
        await createHandoffEvent();
        rerender();
        toast("Handoff created", 3500);
      } catch (error) {
        console.error("Handoff failed:", error);
        toast(error.message || String(error), 5000);
      }
      return;
    case "copyHandoffLink":
      if (!state.ui.lastHandoff.url) return;
      await navigator.clipboard?.writeText(state.ui.lastHandoff.url);
      toast("Handoff link copied", 3000);
      return;
    case "generateClientPlan": {
      const planProject = getActiveProject();
      if (!planProject) return;
      const externalDated = getAllSessions(planProject).filter((s) => s.type !== "internal" && s.date);
      if (!externalDated.length) {
        toast("Schedule at least one external session before generating the client plan.", 4500);
        return;
      }
      const html = buildClientPlanHTML(planProject);
      const safeName = (planProject.clientName || "project").replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_").toLowerCase();
      downloadBlob(html, `${safeName}_training_plan.html`, "text/html");
      toast("Client plan downloaded", 3000);
      return;
    }
    case "searchPeople":
      await searchPeople(state.ui.peopleQuery);
      rerender();
      return;
    case "selectPerson":
      updateOnboardingField("isName", element.dataset.name || "");
      updateOnboardingField("isEmail", element.dataset.email || "");
      state.ui.peopleQuery = element.dataset.email || "";
      rerender();
      return;
    case "switchMobileTab":
      state.ui.mobileTab = element.dataset.tab;
      rerender();
      return;
    case "resetSentinel":
      await resetSentinel();
      rerender();
      return;
    case "dismissProjectError":
      clearProjectError();
      rerender();
      return;
    default:
      break;
  }
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const element = event.target.closest("[data-action]");
    if (!element) return;
    event.preventDefault();
    try {
      await actionHandlers(element.dataset.action, element);
    } catch (error) {
      console.error(`Action ${element.dataset.action} failed:`, error);
      toast(error.message || String(error), 5000);
    }
  });

  document.addEventListener("change", (event) => {
    const bound = event.target.closest("[data-bind]");
    if (bound) {
      applyBinding(bound.dataset.bind, bound.value);
      return;
    }

    const actionable = event.target.closest("[data-action]");
    if (actionable && ["setSmartStart", "setSessionDate", "setSessionTime", "setSessionDuration"].includes(actionable.dataset.action)) {
      actionHandlers(actionable.dataset.action, actionable).catch((error) => {
        console.error(`Change action ${actionable.dataset.action} failed:`, error);
        toast(error.message || String(error), 5000);
      });
    }
  });

  document.addEventListener("input", (event) => {
    const actionable = event.target.closest("[data-action]");
    if (actionable && actionable.dataset.action === "projectSearch") {
      state.ui.projectSearch = actionable.value || "";
      rerender();
    }
  });

  document.addEventListener("dragstart", (event) => {
    const element = event.target.closest("[data-drag]");
    if (!element) return;
    state.dragData = {
      sessionId: element.dataset.id,
      type: element.dataset.drag,
    };
    element.classList.add("dragging");
  });

  document.addEventListener("dragend", (event) => {
    event.target.closest("[data-drag]")?.classList.remove("dragging");
    state.dragData = null;
  });

  document.addEventListener("dragover", (event) => {
    const dropTarget = event.target.closest("[data-drop],[data-drop-dv]");
    if (!dropTarget || !state.dragData) return;
    event.preventDefault();
  });

  document.addEventListener("drop", async (event) => {
    if (!state.dragData) return;
    const calendarDrop = event.target.closest("[data-drop]");
    if (calendarDrop) {
      event.preventDefault();
      if (dropOnDate(state.dragData.sessionId, calendarDrop.dataset.date)) {
        await persistAndRender(true);
      } else {
        rerender();
      }
      state.dragData = null;
      return;
    }

    const dayViewDrop = event.target.closest("[data-drop-dv]");
    if (dayViewDrop) {
      event.preventDefault();
      const slot = dayViewSlotFromEvent(event, dayViewDrop);
      const time = timeFromSlot(slot);
      const date = dayViewDrop.dataset.date;
      const setDateOk = setSessionDate(state.dragData.sessionId, date);
      const setTimeOk = setDateOk && setSessionTime(state.dragData.sessionId, time);
      if (setDateOk && setTimeOk) {
        await persistAndRender(true);
      } else {
        rerender();
      }
      state.dragData = null;
    }
  });
}

async function init() {
  const deepLink = new URL(window.location.href).searchParams.get("project");
  if (deepLink) {
    try {
      setDeepLink(deepLink, decodeProjectParam(deepLink));
      setActorMode("is", "is");
    } catch (error) {
      console.error("Deep link decode failed:", error);
      toast("The handoff link could not be decoded.", 5000);
    }
  }

  bindEvents();
  rerender();
  await bootstrapMsal();
  if (state.graphAccount) {
    await handleDeepLinkIfPresent();
    await refreshProjectContext();
  }
  rerender();
}

init();
