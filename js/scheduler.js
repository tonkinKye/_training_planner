import {
  clearProjectError,
  getActiveProject,
  resetCalendarAvailability,
  setActiveProject,
  setActorMode,
  setCalendarEvents,
  setScreen,
  state,
  upsertProject,
} from "./state.js";
import { getCalendarOwnerForPhase, getCalendarSourceReadiness } from "./calendar-sources.js";
import {
  addCustomSession,
  canEditSession,
  cloneProject,
  computeImplementationStart,
  createOnboardingDraft,
  createProjectFromDraft,
  DEFAULT_WORKING_DAYS,
  deriveProjectStatus,
  findSession,
  getAllSessions,
  getConflictReviewSessions,
  getEditableSessions,
  getLockedPhaseSessions,
  getPhaseGateSession,
  INTERNAL_SETUP_BUFFER_DAYS,
  isSessionBeforePhaseGate,
  getPhaseSessions,
  getPhaseStages,
  getProjectById,
  getProjectDateRange,
  getPushableSessions,
  getSuggestedGoLive,
  getStageForSession,
  getWindowForPhase,
  isDateWithinPhaseWindow,
  moveSession,
  normalizeProject,
  PHASE_ORDER,
  pmCanEditImplementation,
  projectHasImplementationReady,
  recomputeStageRange,
  removeSession,
  touchProject,
} from "./projects.js";
import { mondayOf, parseDate, toDateStr, toast } from "./utils.js";

const SMART_FILL_PREFERENCES = new Set(["am", "none", "pm"]);
const WORK_START_MINUTES = 8 * 60 + 30;
const HALF_DAY_BOUNDARY_MINUTES = 12 * 60;
const WORK_END_MINUTES = 17 * 60;
const SLOT_INCREMENT_MINUTES = 30;
const IMPLEMENTATION_BASE_WEEKLY_CAP = 2;
const IMPLEMENTATION_PROMOTED_WEEKLY_CAP = 3;
const NEW_STAGE_VALUE = "__new__";

function addDays(date, amount) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function getTodayString() {
  return toDateStr(new Date());
}

function dayAfter(dateString) {
  return dateString ? toDateStr(addDays(parseDate(dateString), 1)) : "";
}

function dayBefore(dateString) {
  return dateString ? toDateStr(addDays(parseDate(dateString), -1)) : "";
}

function maxDate(...values) {
  return values.filter(Boolean).sort().at(-1) || "";
}

function normalizeSmartFillPreference(value) {
  return SMART_FILL_PREFERENCES.has(value) ? value : "none";
}

function invalidateSessionInviteState(session, { preserveGraphEventId = true } = {}) {
  session.graphActioned = false;
  session.outlookActioned = false;
  if (!preserveGraphEventId) {
    session.graphEventId = "";
  }
}

function getCurrentProjectOrToast() {
  const project = getActiveProject();
  if (!project) {
    toast("Select a project first");
    return null;
  }
  return project;
}

function settingsImplementationEditingAllowed(project = getCurrentProjectOrToast()) {
  if (!project || state.actor !== "pm") return true;
  return pmCanEditImplementation(project);
}

function ensureFutureDate(value) {
  return !value || value >= getTodayString();
}

export function validateSessionDateChange(project, session, value) {
  if (!ensureFutureDate(value)) {
    return {
      ok: false,
      reason: "past",
      message: "Cannot schedule in the past",
    };
  }

  if (session?.lockedDate && value && value !== session.date) {
    return {
      ok: false,
      reason: "locked",
      message: "This session date is managed by the system",
    };
  }

  if (value && !isDateWithinPhaseWindow(project, session, value)) {
    return {
      ok: false,
      reason: "phase_window",
      message: "Date is outside the phase window",
    };
  }

  return {
    ok: true,
    reason: "",
    message: "",
  };
}

function setCalendarStartFromProject(project) {
  const today = getTodayString();
  const futureDated = getAllSessions(project)
    .filter((session) => session.date && session.date >= today)
    .map((session) => session.date)
    .sort();
  state.calStart = mondayOf(parseDate(futureDated[0] || today));
}

function getStageOptions(source, phaseKey) {
  return getPhaseStages(source, phaseKey).map((stage) => ({
    key: stage.key,
    label: stage.label,
  }));
}

function ensureBuilderStage(source, builderKey) {
  const builder = source?.[builderKey];
  if (!builder) return;

  const stageOptions = getStageOptions(source, builder.phase);
  if (!stageOptions.length) {
    builder.stageKey = "";
    return;
  }

  if (builder.stageKey === NEW_STAGE_VALUE) return;
  if (!stageOptions.some((stage) => stage.key === builder.stageKey)) {
    builder.stageKey = stageOptions[0].key;
  }
}

function buildGoLiveWarning(source, suggestion) {
  if (!source?.goLiveDate || !suggestion.suggestedDate) {
    return suggestion.warning || "";
  }

  if (source.goLiveDate < suggestion.suggestedDate) {
    return `This timeline may be too tight. Minimum recommended is ${suggestion.recommendedWeeks} weeks for this template.`;
  }

  return suggestion.warning || "";
}

function refreshGoLiveSuggestion(source, { forceAutofill = false } = {}) {
  if (!source) return;

  const suggestion = getSuggestedGoLive(source);
  source.goLiveSuggestedDate = suggestion.suggestedDate;
  source.goLiveRecommendedWeeks = suggestion.recommendedWeeks;
  source.goLiveWarning = buildGoLiveWarning(source, suggestion);

  if ((forceAutofill || !source.goLiveManuallySet || !source.goLiveDate) && suggestion.suggestedDate) {
    source.goLiveDate = suggestion.suggestedDate;
  }
}

function createDraftFromAccount() {
  const defaultTemplate = state.templateLibrary.find((template) => template.key === "manufacturing") || state.templateLibrary[0] || null;
  const draft = createOnboardingDraft(defaultTemplate?.key || "manufacturing", {
    templateSnapshot: defaultTemplate ? cloneValue(defaultTemplate) : null,
    templateLabel: defaultTemplate?.label || "",
    templateOriginKey: defaultTemplate?.key || "manufacturing",
  });
  if (state.graphAccount) {
    draft.pmName = state.graphAccount.name || "";
    draft.pmEmail = state.graphAccount.username || "";
  }
  refreshGoLiveSuggestion(draft, { forceAutofill: true });
  ensureBuilderStage(draft, "customSession");
  return draft;
}

function getLibraryTemplate(templateKey) {
  return state.templateLibrary.find((template) => template.key === templateKey) || null;
}

function setOnboardingTemplateReviewJSON(draft) {
  const reviewTemplate = draft?.templateSnapshot || getLibraryTemplate(draft?.templateOriginKey || draft?.projectType || draft?.templateKey);
  state.ui.onboarding.templateReviewJSON = reviewTemplate ? JSON.stringify(reviewTemplate, null, 2) : "";
}

function resetSmartFillDefaults(project) {
  state.ui.smartPreference = normalizeSmartFillPreference(project?.smartFillPreference);
  state.ui.activeDays = new Set(
    Array.isArray(project?.workingDays) && project.workingDays.length ? project.workingDays : DEFAULT_WORKING_DAYS
  );
  state.ui.smartStart = project?.projectStart || project?.implementationStart || getTodayString();
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
  resetSmartFillDefaults(project);
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
  if (left.stageKey !== right.stageKey) {
    return String(left.stageKey || "").localeCompare(String(right.stageKey || ""));
  }
  return (left.order || 0) - (right.order || 0);
}

function compareDatedSessions(left, right) {
  const leftDate = left.date || "9999-12-31";
  const rightDate = right.date || "9999-12-31";
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  const leftTime = left.time || "99:99";
  const rightTime = right.time || "99:99";
  if (leftTime !== rightTime) {
    return leftTime.localeCompare(rightTime);
  }

  return compareSessions(left, right);
}

function getEditablePhaseKeys(project, actor = state.actor) {
  const editable = getEditableSessions(project, actor);
  return PHASE_ORDER.filter((phaseKey) => editable.some((session) => session.phase === phaseKey));
}

function getSmartFillSearchStart(dateString, windowMin = "", startAfterDate = "") {
  return maxDate(getTodayString(), dateString || "", windowMin || "", startAfterDate ? dayAfter(startAfterDate) : "");
}

function getEligibleDatesBetween(startDate, endDate, activeDays = state.ui.activeDays) {
  if (!startDate || !endDate || startDate > endDate) return [];

  const dates = [];
  const cursor = parseDate(startDate);
  const end = parseDate(endDate);
  while (cursor <= end) {
    if (activeDays.has(cursor.getDay())) {
      dates.push(toDateStr(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

const WEEKDAYS = new Set(DEFAULT_WORKING_DAYS);

function getInternalBufferDates(project) {
  const projectStart = project?.projectStart || "";
  if (!projectStart) return [];
  const bufferStart = toDateStr(addDays(parseDate(projectStart), -INTERNAL_SETUP_BUFFER_DAYS));
  const bufferEnd = dayBefore(projectStart);
  return bufferStart <= bufferEnd ? getEligibleDatesBetween(bufferStart, bufferEnd, WEEKDAYS) : [];
}

function getSmartFillWindowForPhase(project, phaseKey, previousPhaseLastDate = "") {
  const window = getWindowForPhase(project, phaseKey);
  const effectiveSmartStart = state.actor === "pm" && window.min && state.ui.smartStart > window.min
    && phaseKey !== "setup"
    ? window.min
    : state.ui.smartStart;
  const start = getSmartFillSearchStart(effectiveSmartStart, window.min, previousPhaseLastDate);
  let end = window.max || start;

  if (phaseKey === "implementation") {
    const lockedAnchor = getLockedPhaseSessions(project, "implementation")[0];
    const anchorDate = lockedAnchor?.date || project.goLiveDate;
    if (anchorDate) {
      end = dayBefore(anchorDate);
    }
  }

  return {
    start,
    end,
    dates: getEligibleDatesBetween(start, end),
  };
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

function recomputeAffectedStages(stages = []) {
  for (const stage of new Set(stages.filter(Boolean))) {
    recomputeStageRange(stage);
  }
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

function spreadDates(dates, count) {
  if (!dates.length || count <= 0) return [];

  const picks = [];
  for (let index = 0; index < count; index += 1) {
    const dateIndex = Math.min(dates.length - 1, Math.floor((index * dates.length) / count));
    picks.push(dates[dateIndex]);
  }
  return picks;
}

function spreadDatesWithSecondPass(dates, count) {
  if (!dates.length || count <= 0) return [];
  const firstCount = Math.min(count, dates.length);
  const picks = [...spreadDates(dates, firstCount)];
  const remaining = count - firstCount;
  if (remaining > 0) {
    picks.push(...spreadDates(dates, Math.min(remaining, dates.length)));
  }
  return picks;
}

function pickInternalDates(
  dates,
  count,
  preferredDays = state.ui.activeDays,
  { preferLatest = false, preferOffPreference = true } = {}
) {
  if (!dates.length || count <= 0) return [];

  const orderedDates = preferLatest ? [...dates].slice().reverse() : [...dates];
  if (!preferOffPreference) {
    return spreadDatesWithSecondPass(orderedDates, count);
  }

  const offPreference = [];
  const preferred = [];
  for (const dateString of orderedDates) {
    if (preferredDays.has(parseDate(dateString).getDay())) {
      preferred.push(dateString);
    } else {
      offPreference.push(dateString);
    }
  }

  const picks = [];
  if (offPreference.length) {
    picks.push(...spreadDatesWithSecondPass(offPreference, Math.min(count, offPreference.length)));
  }

  const remaining = count - picks.length;
  if (remaining > 0) {
    picks.push(...spreadDatesWithSecondPass(preferred, remaining));
  }

  return picks;
}

function getSetupKickOffAnchorDate(project, previousPhaseLastDate = "") {
  return getSmartFillSearchStart(state.ui.smartStart || project?.projectStart || "", project?.projectStart || "", previousPhaseLastDate);
}

function pinPhaseGateSession(project, phaseKey, stageStates, previousPhaseLastDate, result) {
  const gateDate = phaseKey === "setup"
    ? getSetupKickOffAnchorDate(project, previousPhaseLastDate)
    : "";
  if (!gateDate) return "";

  const gateSession = getPhaseGateSession(project, phaseKey);
  if (!gateSession) return "";

  for (const stageState of stageStates) {
    const gateIndex = stageState.pendingSessions.findIndex((session) => session.id === gateSession.id);
    if (gateIndex < 0) continue;

    const [phaseGateSession] = stageState.pendingSessions.splice(gateIndex, 1);
    stageState.fixedDates.push(gateDate);
    applySessionDate(phaseGateSession, gateDate);
    result.datedCount += 1;
    return gateDate;
  }

  return gateDate;
}

function getNeighboringSessionDates(stage, session) {
  const dated = (stage?.sessions || []).filter((candidate) => candidate.id !== session.id && candidate.date);
  const previous = dated
    .filter((candidate) => (candidate.order || 0) < (session.order || 0))
    .map((candidate) => candidate.date)
    .sort()
    .at(-1) || "";
  const next = dated
    .filter((candidate) => (candidate.order || 0) > (session.order || 0))
    .map((candidate) => candidate.date)
    .sort()[0] || "";
  return {
    previous,
    next,
  };
}

function allocateSequentialCounts(stageStates, totalDateCount) {
  const counts = new Map();
  if (!stageStates.length || totalDateCount <= 0) {
    stageStates.forEach((stageState) => counts.set(stageState.stage.key, 0));
    return counts;
  }

  if (totalDateCount < stageStates.length) {
    stageStates.forEach((stageState, index) => counts.set(stageState.stage.key, index < totalDateCount ? 1 : 0));
    return counts;
  }

  const weights = stageStates.map((stageState) => Math.max(1, stageState.weight));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const remainingDates = totalDateCount - stageStates.length;
  const details = stageStates.map((stageState, index) => {
    const rawExtra = totalWeight ? (weights[index] / totalWeight) * remainingDates : 0;
    const extra = Math.floor(rawExtra);
    return {
      key: stageState.stage.key,
      count: 1 + extra,
      remainder: rawExtra - extra,
    };
  });

  let leftover = totalDateCount - details.reduce((sum, detail) => sum + detail.count, 0);
  details
    .slice()
    .sort((left, right) => right.remainder - left.remainder)
    .forEach((detail) => {
      if (leftover <= 0) return;
      detail.count += 1;
      leftover -= 1;
    });

  details.forEach((detail) => counts.set(detail.key, detail.count));
  return counts;
}

function getLatestSessionDate(sessions) {
  return sessions
    .filter((session) => session.date)
    .map((session) => session.date)
    .sort()
    .at(-1) || "";
}

function getStageFixedDates(stage) {
  return (stage.sessions || [])
    .filter((session) => !session.lockedDate && session.date)
    .map((session) => session.date)
    .sort();
}

function buildStageStates(project, phaseKey, actor) {
  return getPhaseStages(project, phaseKey).map((stage) => {
    const placeableSessions = stage.sessions.filter((session) => !session.lockedDate);
    const pendingSessions = placeableSessions
      .filter((session) => !session.date && canEditSession(project, session, actor))
      .sort(compareSessions);
    const fixedDates = getStageFixedDates(stage);
    return {
      stage,
      hasLockedSession: stage.sessions.some((session) => session.lockedDate),
      weight: placeableSessions.length || fixedDates.length || 1,
      pendingSessions,
      fixedDates,
    };
  });
}

function assignSetupOrHypercareStage(stageState, stageDates) {
  const picks = spreadDatesWithSecondPass(stageDates, stageState.pendingSessions.length);
  const assignments = stageState.pendingSessions.slice(0, picks.length).map((session, index) => [session, picks[index]]);
  return {
    assignments,
    unplaced: stageState.pendingSessions.slice(assignments.length),
  };
}

function assignImplementationStage(stageState, stageDates) {
  const weeks = groupDatesByWeek(stageDates);
  let totalCapacity = weeks.reduce((sum, week) => sum + week.capacity, 0);

  if (totalCapacity < stageState.pendingSessions.length) {
    for (const week of weeks) {
      const promoted = Math.min(IMPLEMENTATION_PROMOTED_WEEKLY_CAP, week.physicalCapacity);
      if (promoted <= week.capacity) continue;
      totalCapacity += promoted - week.capacity;
      week.capacity = promoted;
      if (totalCapacity >= stageState.pendingSessions.length) {
        break;
      }
    }
  }

  const assignments = [];
  let sessionIndex = 0;
  for (const week of weeks) {
    if (sessionIndex >= stageState.pendingSessions.length) break;
    const placements = spreadDatesWithSecondPass(
      week.dates,
      Math.min(week.capacity, stageState.pendingSessions.length - sessionIndex)
    );
    for (const dateString of placements) {
      const session = stageState.pendingSessions[sessionIndex];
      if (!session) break;
      assignments.push([session, dateString]);
      sessionIndex += 1;
    }
  }

  return {
    assignments,
    unplaced: stageState.pendingSessions.slice(sessionIndex),
  };
}

function assignStageDates(phaseKey, stageState, stageDates) {
  if (!stageState.pendingSessions.length || !stageDates.length) {
    return {
      assignments: [],
      unplaced: [...stageState.pendingSessions],
    };
  }

  if (phaseKey === "implementation") {
    return assignImplementationStage(stageState, stageDates);
  }

  return assignSetupOrHypercareStage(stageState, stageDates);
}

function setStageRange(stage, stageDates, fixedDates = []) {
  const previousStart = stage.rangeStart || "";
  const previousEnd = stage.rangeEnd || "";
  const allDates = [...stageDates, ...fixedDates].filter(Boolean).sort();
  stage.rangeStart = allDates[0] || "";
  stage.rangeEnd = allDates.at(-1) || "";
  return stage.rangeStart !== previousStart || stage.rangeEnd !== previousEnd;
}

function getSmartFillPhaseBoundary(project, phaseKey, previousPhaseLastDate, actor) {
  const phaseWindow = getSmartFillWindowForPhase(project, phaseKey, previousPhaseLastDate);
  const editableSessions = getEditableSessions(project, actor).filter(
    (session) => session.phase === phaseKey && !session.lockedDate
  );

  return {
    ...phaseWindow,
    editableSessions,
  };
}

function runPhaseSmartFill(project, phaseKey, actor, previousPhaseLastDate, result) {
  const phaseState = getSmartFillPhaseBoundary(project, phaseKey, previousPhaseLastDate, actor);
  const stageStates = buildStageStates(project, phaseKey, actor);

  if (phaseKey === "setup") {
    pinPhaseGateSession(project, phaseKey, stageStates, previousPhaseLastDate, result);
  }

  // Pre-pass: place internal setup sessions in the buffer period before projectStart
  if (phaseKey === "setup" && project.projectStart) {
    const bufferDates = getInternalBufferDates(project);
    if (bufferDates.length) {
      const internalSessions = [];
      for (const stageState of stageStates) {
        const internal = stageState.pendingSessions.filter(
          (candidate) => candidate.type === "internal" && isSessionBeforePhaseGate(project, candidate)
        );
        internalSessions.push(...internal);
        const internalIds = new Set(internal.map((s) => s.id));
        stageState.pendingSessions = stageState.pendingSessions.filter((s) => !internalIds.has(s.id));
      }
      if (internalSessions.length) {
        const picks = pickInternalDates(bufferDates, internalSessions.length, state.ui.activeDays, {
          preferLatest: true,
          preferOffPreference: false,
        });
        for (let i = 0; i < Math.min(internalSessions.length, picks.length); i += 1) {
          applySessionDate(internalSessions[i], picks[i]);
          result.datedCount += 1;
        }
        const overflow = internalSessions.slice(picks.length);
        if (overflow.length) {
          console.info(`[TP smartfill] ${overflow.length} internal setup session(s) could not fit in buffer, will use main dates`);
          for (const stageState of stageStates) {
            const stage = stageState.stage;
            const overflowForStage = overflow.filter((s) => s.stageKey === stage.key);
            stageState.pendingSessions.unshift(...overflowForStage);
          }
        }
      }
    }
  }

  // Extract remaining internal sessions — they use weekday dates, not activeDays
  const deferredInternal = new Map();
  for (const stageState of stageStates) {
    const internal = stageState.pendingSessions.filter((s) => s.type === "internal");
    if (internal.length) {
      deferredInternal.set(stageState.stage.key, { sessions: internal, stage: stageState.stage });
      const ids = new Set(internal.map((s) => s.id));
      stageState.pendingSessions = stageState.pendingSessions.filter((s) => !ids.has(s.id));
    }
  }

  const allocatableStages = stageStates.filter((stageState) => !stageState.hasLockedSession);
  const stageCounts = allocateSequentialCounts(allocatableStages, phaseState.dates.length);

  let dateOffset = 0;
  let lastStageBoundary = previousPhaseLastDate;

  for (const stageState of stageStates) {
    const { stage, hasLockedSession } = stageState;

    if (hasLockedSession) {
      const previousStart = stage.rangeStart || "";
      const previousEnd = stage.rangeEnd || "";
      const lockedDate = stage.sessions.find((session) => session.lockedDate)?.date || project.goLiveDate || "";
      stage.rangeStart = lockedDate;
      stage.rangeEnd = lockedDate;
      if (stage.rangeStart !== previousStart || stage.rangeEnd !== previousEnd) {
        result.rangeCount += 1;
      }
      continue;
    }

    const dateCount = stageCounts.get(stage.key) || 0;
    const rawStageDates = phaseState.dates.slice(dateOffset, dateOffset + dateCount);
    dateOffset += dateCount;
    const stageDates = rawStageDates.filter((dateString) => !lastStageBoundary || dateString > lastStageBoundary);
    const distribution = assignStageDates(phaseKey, stageState, stageDates);

    if (setStageRange(stage, stageDates, stageState.fixedDates)) {
      result.rangeCount += 1;
    }

    for (const [session, dateString] of distribution.assignments) {
      applySessionDate(session, dateString);
      result.datedCount += 1;
    }

    if (distribution.unplaced.length) {
      result.unplacedSessionIds.push(...distribution.unplaced.map((session) => session.id));
      result.unplacedCount += distribution.unplaced.length;
    }

    lastStageBoundary = maxDate(lastStageBoundary, stage.rangeEnd || "", getLatestSessionDate(stage.sessions));
  }

  // Post-pass: place deferred internal sessions using weekday dates
  for (const [, { sessions, stage }] of deferredInternal) {
    const unplaced = [];
    for (const session of sessions) {
      const { previous, next } = getNeighboringSessionDates(stage, session);
      const rangeStart = previous || stage.rangeStart || phaseState.start;
      const rangeEnd = next || stage.rangeEnd || phaseState.end;
      const weekdayDates = getEligibleDatesBetween(rangeStart, rangeEnd, WEEKDAYS);
      const picks = pickInternalDates(weekdayDates, 1, state.ui.activeDays, {
        preferLatest: !next,
      });
      const pickedDate = picks[0] || "";
      if (!pickedDate) {
        unplaced.push(session);
        continue;
      }
      applySessionDate(session, pickedDate);
      result.datedCount += 1;
    }

    const allDates = stage.sessions
      .filter((session) => !session.lockedDate && session.date)
      .map((session) => session.date)
      .sort();
    stage.rangeStart = allDates[0] || stage.rangeStart;
    stage.rangeEnd = allDates.at(-1) || stage.rangeEnd;

    if (unplaced.length) {
      result.unplacedSessionIds.push(...unplaced.map((session) => session.id));
      result.unplacedCount += unplaced.length;
    }
  }

  return maxDate(previousPhaseLastDate, getLatestSessionDate(getPhaseSessions(project, phaseKey)));
}

function getDateEvents(dateString) {
  return state.calendarEvents.filter((event) => event.start?.slice(0, 10) === dateString);
}

function getTimedIntervalsForDate(project, session, dateString, currentSessionId = "", pendingAssignments = new Map()) {
  const intervals = [];
  const requiredOwner = getCalendarOwnerForPhase(session?.phase);

  for (const event of getDateEvents(dateString)) {
    if (event.calendarOwner !== requiredOwner) continue;
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

function findOpenSlot(duration, intervals, preferredHalf, minStartMinutes = 0) {
  const ranges =
    preferredHalf === "pm"
      ? [
          [HALF_DAY_BOUNDARY_MINUTES, WORK_END_MINUTES],
          [WORK_START_MINUTES, HALF_DAY_BOUNDARY_MINUTES],
          [WORK_START_MINUTES, WORK_END_MINUTES],
        ]
      : [
          [WORK_START_MINUTES, HALF_DAY_BOUNDARY_MINUTES],
          [HALF_DAY_BOUNDARY_MINUTES, WORK_END_MINUTES],
          [WORK_START_MINUTES, WORK_END_MINUTES],
        ];

  for (const [rangeStart, rangeEnd] of ranges) {
    const effectiveStart = Math.max(rangeStart, minStartMinutes);
    const slotStart = effectiveStart + ((SLOT_INCREMENT_MINUTES - (effectiveStart % SLOT_INCREMENT_MINUTES)) % SLOT_INCREMENT_MINUTES);
    for (let minutes = slotStart; minutes + duration <= rangeEnd; minutes += SLOT_INCREMENT_MINUTES) {
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
  const draft = cloneProject(project);
  const implementationEditable = settingsImplementationEditingAllowed(project);
  draft.goLiveSuggestedDate = "";
  draft.goLiveRecommendedWeeks = 0;
  draft.goLiveWarning = "";
  draft.goLiveManuallySet = false;
  refreshGoLiveSuggestion(draft, { forceAutofill: false });
  draft.goLiveManuallySet = Boolean(draft.goLiveDate && draft.goLiveDate !== draft.goLiveSuggestedDate);
  draft.newSession = {
    phase: implementationEditable ? "implementation" : "setup",
    stageKey: implementationEditable ? getPhaseStages(draft, "implementation")[0]?.key || "" : getPhaseStages(draft, "setup")[0]?.key || "",
    newStageLabel: "",
    owner: implementationEditable ? "is" : "pm",
    name: "",
    duration: 90,
    type: "external",
  };
  state.ui.settings.draft = draft;
}

function syncProjectDraftAfterSessionMutation(draft) {
  ensureBuilderStage(draft, "customSession");
  ensureBuilderStage(draft, "newSession");
  refreshGoLiveSuggestion(draft, { forceAutofill: false });
}

function updateDraftWorkingDays(draft, day) {
  const next = new Set(Array.isArray(draft.workingDays) ? draft.workingDays : DEFAULT_WORKING_DAYS);
  if (next.has(day)) {
    next.delete(day);
  } else {
    next.add(day);
  }
  draft.workingDays = [...next].sort((left, right) => left - right);
  if (!draft.workingDays.length) {
    draft.workingDays = [...DEFAULT_WORKING_DAYS];
  }
  refreshGoLiveSuggestion(draft, { forceAutofill: false });
}

function addDraftSession(draft, sessionInput, builderKey) {
  addCustomSession(draft, {
    key: "",
    bodyKey: "",
    name: sessionInput.name.trim(),
    duration: Number(sessionInput.duration) || 90,
    phase: sessionInput.phase,
    stageKey: sessionInput.stageKey === NEW_STAGE_VALUE ? "" : sessionInput.stageKey,
    newStageLabel: sessionInput.newStageLabel || "",
    owner: sessionInput.owner || (sessionInput.phase === "implementation" ? "is" : "pm"),
    type: sessionInput.type || "external",
  });

  draft[builderKey].name = "";
  draft[builderKey].duration = 90;
  draft[builderKey].newStageLabel = "";
  ensureBuilderStage(draft, builderKey);
  refreshGoLiveSuggestion(draft, { forceAutofill: false });
}

export function openOnboarding() {
  state.ui.onboarding.open = true;
  state.ui.onboarding.step = 0;
  state.ui.onboarding.draft = createDraftFromAccount();
  setOnboardingTemplateReviewJSON(state.ui.onboarding.draft);
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
  const draft = state.ui.onboarding.draft;
  if (!draft) return;

  if (field === "projectType") {
    const selectedTemplate = getLibraryTemplate(value);
    const next = createOnboardingDraft(value, {
      templateSnapshot: selectedTemplate ? cloneValue(selectedTemplate) : null,
      templateLabel: selectedTemplate?.label || "",
      templateOriginKey: value,
    });
    next.clientName = draft.clientName;
    next.pmName = draft.pmName;
    next.pmEmail = draft.pmEmail;
    next.isName = draft.isName;
    next.isEmail = draft.isEmail;
    next.implementationStart = draft.implementationStart;
    next.goLiveDate = draft.goLiveDate;
    next.hypercareDuration = draft.hypercareDuration;
    next.smartFillPreference = draft.smartFillPreference;
    next.workingDays = [...draft.workingDays];
    next.invitees = draft.invitees;
    next.location = draft.location;
    next.goLiveManuallySet = draft.goLiveManuallySet;
    refreshGoLiveSuggestion(next, { forceAutofill: false });
    state.ui.onboarding.draft = next;
    setOnboardingTemplateReviewJSON(next);
    return;
  }

  if (field === "invitees") {
    draft.invitees = value;
    return;
  }

  if (field === "goLiveDate") {
    draft.goLiveDate = value;
    draft.goLiveManuallySet = Boolean(value);
    refreshGoLiveSuggestion(draft, { forceAutofill: false });
    return;
  }

  if (field.startsWith("customSession.")) {
    const key = field.split(".")[1];
    draft.customSession[key] = key === "duration" ? Number(value) || 90 : value;
    if (key === "phase") {
      draft.customSession.owner = value === "implementation" ? "is" : "pm";
      ensureBuilderStage(draft, "customSession");
    }
    if (key === "stageKey" && value !== NEW_STAGE_VALUE) {
      draft.customSession.newStageLabel = "";
    }
    return;
  }

  if (field === "projectStart") {
    draft.projectStart = value;
    const computed = computeImplementationStart(draft);
    if (computed) draft.implementationStart = computed;
    refreshGoLiveSuggestion(draft, { forceAutofill: !draft.goLiveManuallySet });
    return;
  }

  draft[field] = value;
  if (field === "implementationStart") {
    refreshGoLiveSuggestion(draft, { forceAutofill: false });
  }
}

export function toggleOnboardingWorkingDay(day) {
  const draft = state.ui.onboarding.draft;
  if (!draft) return;
  updateDraftWorkingDays(draft, day);
}

export function addOnboardingSession() {
  const draft = state.ui.onboarding.draft;
  if (!draft) return;

  if (!draft.customSession.name.trim()) {
    toast("Add a session name first");
    return;
  }

  addDraftSession(draft, draft.customSession, "customSession");
}

export function removeOnboardingSession(sessionId) {
  const draft = state.ui.onboarding.draft;
  if (!draft) return;
  if (findSession(draft, sessionId)?.session?.lockedDate) return;
  removeSession(draft, sessionId);
  syncProjectDraftAfterSessionMutation(draft);
}

export function moveOnboardingSession(sessionId, direction) {
  const draft = state.ui.onboarding.draft;
  if (!draft) return;
  if (findSession(draft, sessionId)?.session?.lockedDate) return;
  moveSession(draft, sessionId, direction);
  syncProjectDraftAfterSessionMutation(draft);
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
  openProject(project.id, { actor: "pm", mode: "pm" });
  closeOnboarding();
  clearProjectError();
  return project;
}

export function openProject(projectId, { actor = "pm", mode = actor } = {}) {
  const project = getProjectById(state.projects, projectId);
  if (!project) return null;
  setActiveProject(project.id);
  setActorMode(actor, mode);
  setCalendarEvents([]);
  resetCalendarAvailability({ projectId: project.id });
  setScreen("workspace");
  setCalendarStartFromProject(project);
  resetSmartFillDefaults(project);
  state.ui.expandedPhaseSections = new Set();
  state.ui.expandedStageSections = new Set();
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

  if (field === "invitees") {
    draft.invitees = value;
    return;
  }

  if (field === "goLiveDate") {
    draft.goLiveDate = value;
    draft.goLiveManuallySet = Boolean(value);
    refreshGoLiveSuggestion(draft, { forceAutofill: false });
    return;
  }

  if (field.startsWith("newSession.")) {
    const key = field.split(".")[1];
    draft.newSession[key] = key === "duration" ? Number(value) || 90 : value;
    if (key === "phase") {
      if (value === "implementation" && !settingsImplementationEditingAllowed()) {
        draft.newSession.phase = "setup";
        draft.newSession.owner = "pm";
        ensureBuilderStage(draft, "newSession");
        return;
      }
      draft.newSession.owner = value === "implementation" ? "is" : "pm";
      ensureBuilderStage(draft, "newSession");
    }
    if (key === "stageKey" && value !== NEW_STAGE_VALUE) {
      draft.newSession.newStageLabel = "";
    }
    return;
  }

  if (field === "projectStart") {
    draft.projectStart = value;
    const computed = computeImplementationStart(draft);
    if (computed) draft.implementationStart = computed;
    refreshGoLiveSuggestion(draft, { forceAutofill: !draft.goLiveManuallySet });
    return;
  }

  draft[field] = value;
  if (field === "implementationStart" || field === "projectType") {
    if (field === "projectType") {
      const selectedTemplate = getLibraryTemplate(value);
      draft.templateKey = value;
      draft.templateOriginKey = value;
      draft.templateLabel = selectedTemplate?.label || draft.templateLabel;
      draft.templateCustomized = false;
      draft.templateSnapshot = selectedTemplate ? cloneValue(selectedTemplate) : null;
      draft.phases = {
        setup: normalizeProject({
          ...draft,
          templateKey: value,
          templateOriginKey: value,
          templateSnapshot: selectedTemplate ? cloneValue(selectedTemplate) : null,
          phases: {},
        }).phases.setup,
        implementation: normalizeProject({
          ...draft,
          templateKey: value,
          templateOriginKey: value,
          templateSnapshot: selectedTemplate ? cloneValue(selectedTemplate) : null,
          phases: {},
        }).phases.implementation,
        hypercare: normalizeProject({
          ...draft,
          templateKey: value,
          templateOriginKey: value,
          templateSnapshot: selectedTemplate ? cloneValue(selectedTemplate) : null,
          phases: {},
        }).phases.hypercare,
      };
      ensureBuilderStage(draft, "newSession");
    }
    refreshGoLiveSuggestion(draft, { forceAutofill: false });
  }
}

export function toggleSettingsWorkingDay(day) {
  const draft = state.ui.settings.draft;
  if (!draft) return;
  updateDraftWorkingDays(draft, day);
}

export function addSettingsSession() {
  const draft = state.ui.settings.draft;
  if (!draft) return;
  if (draft.newSession.phase === "implementation" && !settingsImplementationEditingAllowed()) {
    toast("Implementation sessions are read-only after handoff.");
    return;
  }
  if (!draft.newSession.name.trim()) {
    toast("Add a session name first");
    return;
  }

  addDraftSession(draft, draft.newSession, "newSession");
}

export function removeSettingsSession(sessionId) {
  const draft = state.ui.settings.draft;
  if (!draft) return;
  const found = findSession(draft, sessionId);
  if (!found || found.session?.lockedDate) return;
  if (found.session.phase === "implementation" && !settingsImplementationEditingAllowed()) {
    toast("Implementation sessions are read-only after handoff.");
    return;
  }
  removeSession(draft, sessionId);
  syncProjectDraftAfterSessionMutation(draft);
}

export function moveSettingsSession(sessionId, direction) {
  const draft = state.ui.settings.draft;
  if (!draft) return;
  const found = findSession(draft, sessionId);
  if (!found || found.session?.lockedDate) return;
  if (found.session.phase === "implementation" && !settingsImplementationEditingAllowed()) {
    toast("Implementation sessions are read-only after handoff.");
    return;
  }
  moveSession(draft, sessionId, direction);
  syncProjectDraftAfterSessionMutation(draft);
}

export function saveSettingsDraft() {
  const project = getCurrentProjectOrToast();
  const draft = state.ui.settings.draft;
  if (!project || !draft) return { status: "failed", project: null };

  if (!settingsImplementationEditingAllowed(project)) {
    draft.phases.implementation = cloneProject(project).phases.implementation;
  }

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

  const affectedStages = [];
  for (const sessionId of affectedSessionIds) {
    const found = findSession(nextProject, sessionId);
    if (found) {
      clearSessionScheduling(found.session, { preserveGraphEventId: false });
      affectedStages.push(found.stage);
    }
  }
  recomputeAffectedStages(affectedStages);

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

  const validation = validateSessionDateChange(project, found.session, value);
  if (!validation.ok) {
    toast(
      validation.reason === "phase_window"
        ? `${validation.message} \u2014 check conflicts`
        : validation.message,
      4000
    );
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

  recomputeStageRange(found.stage);

  touchProject(project);
  project.status = deriveProjectStatus(project);

  if (nextValue) {
    const futureSamePhase = getPhaseSessions(project, found.session.phase)
      .filter((s) => s.id !== sessionId && s.date && s.date >= nextValue && !s.lockedDate);
    if (futureSamePhase.length > 0) {
      state.ui.shiftDialog = {
        open: true,
        sessionId,
        newDate: nextValue,
        phaseKey: found.session.phase,
      };
    }
  }

  return true;
}

export function setSessionTime(sessionId, value) {
  const project = getCurrentProjectOrToast();
  if (!project) return false;

  const found = findSession(project, sessionId);
  if (!found || !canEditSession(project, found.session, state.actor) || found.session.lockedTime) return false;
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
  if (!found || !canEditSession(project, found.session, state.actor) || found.session.lockedDate) return false;
  clearSessionScheduling(found.session, { preserveGraphEventId: false });
  recomputeStageRange(found.stage);
  touchProject(project);
  project.status = deriveProjectStatus(project);
  return true;
}

export function removeActiveSession(sessionId) {
  const project = getCurrentProjectOrToast();
  if (!project || state.actor !== "pm") return false;
  const found = findSession(project, sessionId);
  if (!found || found.session?.lockedDate || !canEditSession(project, found.session, state.actor)) return false;
  removeSession(project, sessionId);
  return true;
}

export function moveActiveSession(sessionId, direction) {
  const project = getCurrentProjectOrToast();
  if (!project || state.actor !== "pm") return false;
  const found = findSession(project, sessionId);
  if (!found || found.session?.lockedDate || !canEditSession(project, found.session, state.actor)) return false;
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
    return { ready: false, reason: "no_project", ownerStates: {}, blockingOwners: [] };
  }

  const requiredRange = getSmartFillCoverageRange(project, actor);
  const requiredOwners = [...new Set(getEditablePhaseKeys(project, actor).map((phaseKey) => getCalendarOwnerForPhase(phaseKey)))];
  const ownerStates = {};
  const blockingOwners = [];

  for (const owner of requiredOwners) {
    const readiness = getCalendarSourceReadiness({
      availability: state.calendarAvailability,
      owner,
      projectId: project.id,
      requiredRange,
    });
    ownerStates[owner] = readiness;
    if (!readiness.ready) {
      blockingOwners.push(owner);
    }
  }

  return {
    ready: blockingOwners.length === 0,
    reason: blockingOwners.length ? ownerStates[blockingOwners[0]].reason : "",
    requiredRange,
    ownerStates,
    blockingOwners,
  };
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
    rangeCount: 0,
  };

  let previousPhaseLastDate = "";
  for (const phaseKey of PHASE_ORDER) {
    previousPhaseLastDate = runPhaseSmartFill(project, phaseKey, state.actor, previousPhaseLastDate, result);
  }

  const availabilityState = getSmartAvailabilityState(project, state.actor);
  const pendingAssignments = new Map();
  const today = getTodayString();
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const candidates = getEditableSessions(project, state.actor)
    .filter((session) => session.date && !session.time)
    .sort(compareDatedSessions);

  for (const session of candidates) {
    const sourceReadiness = getCalendarSourceReadiness({
      availability: state.calendarAvailability,
      owner: getCalendarOwnerForPhase(session.phase),
      projectId: project.id,
      requiredRange: availabilityState.requiredRange,
    });

    if (!sourceReadiness.ready) {
      session.availabilityConflict = false;
      result.pass2Skipped = true;
      if (!result.pass2SkipReason) {
        result.pass2SkipReason = sourceReadiness.reason;
      }
      continue;
    }

    const intervals = getTimedIntervalsForDate(project, session, session.date, session.id, pendingAssignments);
    const todayFloor = session.date === today ? currentMinutes : 0;
    const halfPref = session.type === "internal" ? "none" : normalizeSmartFillPreference(state.ui.smartPreference);
    const slot = findOpenSlot(session.duration, intervals, halfPref, todayFloor);
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

  if (!result.datedCount && !result.timedCount && !result.availabilityCount && !result.unplacedCount && !result.rangeCount) {
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

export function confirmShiftRemaining() {
  const { sessionId, newDate, phaseKey } = state.ui.shiftDialog;
  state.ui.shiftDialog = { open: false, sessionId: "", newDate: "", phaseKey: "" };
  if (!sessionId || !phaseKey) return false;

  const project = getCurrentProjectOrToast();
  if (!project) return false;

  const phaseSessions = getPhaseSessions(project, phaseKey)
    .filter((s) => s.id !== sessionId && s.date && s.date >= newDate && !s.lockedDate);
  const affectedStages = [];
  for (const session of phaseSessions) {
    clearSessionScheduling(session, { preserveGraphEventId: false });
    affectedStages.push(getStageForSession(project, session));
  }
  recomputeAffectedStages(affectedStages);

  const result = { datedCount: 0, timedCount: 0, availabilityCount: 0, unplacedCount: 0, pass2Skipped: false, pass2SkipReason: "", unplacedSessionIds: [], availabilitySessionIds: [], rangeCount: 0 };
  runPhaseSmartFill(project, phaseKey, state.actor, dayBefore(newDate), result);
  touchProject(project);
  project.status = deriveProjectStatus(project);
  return true;
}

export function dismissShiftDialog() {
  state.ui.shiftDialog = { open: false, sessionId: "", newDate: "", phaseKey: "" };
}

export function clearSmartFillDates() {
  const project = getCurrentProjectOrToast();
  if (!project) return 0;
  let cleared = 0;
  const affectedStages = [];
  for (const session of getAllSessions(project)) {
    if (!canEditSession(project, session, state.actor)) continue;
    if (session.lockedDate) continue;
    if (!session.date) continue;
    clearSessionScheduling(session, { preserveGraphEventId: false });
    affectedStages.push(getStageForSession(project, session));
    cleared += 1;
  }
  if (cleared) {
    recomputeAffectedStages(affectedStages);
    touchProject(project);
    project.status = deriveProjectStatus(project);
  }
  return cleared;
}
