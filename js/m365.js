import { DEEP_LINK_LIMIT, SENTINEL_SCHEMA_ID, SENTINEL_SUBJECT, getActiveProject, replaceProject, resetCalendarAvailability, setActiveProject, setActorMode, setAuthStatus, setCalendarEvents, setGraphAccount, setProjects, setProjectError, setScreen, setSentinelState, state, upsertProject } from "./state.js";
import { GRAPH_CLIENT_ID, GRAPH_SCOPES, GRAPH_TENANT_ID, PRODUCT_NAME } from "./config.js";
import { classifyCalendarSourceError, getCalendarFetchPlan } from "./calendar-sources.js";
import { buildDeepLinkUrl } from "./deeplink.js";
import { buildBodyHTML, buildSubject, parseInvitees } from "./invites.js";
import {
  deriveProjectStatus,
  findSession,
  getAllSessions,
  getCalendarOwnerName,
  getPhaseSessions,
  getProjectDateRange,
  getProjectById,
  getPushableSessions,
  normalizeProject,
  syncProjectRuntimeState,
} from "./projects.js";
import { buildSentinelProjectRecord, createSentinelPayload, parseSentinelProjects } from "./sentinel-model.js";
import { esc, getLocalTimeZone, pad, toast, toDateStr } from "./utils.js";

const MSAL_CDN_URLS = [
  "https://alcdn.msauth.net/browser/2.39.0/js/msal-browser.min.js",
  "https://unpkg.com/@azure/msal-browser@2.39.0/lib/msal-browser.min.js",
  "https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.39.0/lib/msal-browser.min.js",
];

const GRAPH_TIMEOUT_MS = 30000;
const SENTINEL_LOOKBACK_COUNT = 25;
const GRAPH_BATCH_LIMIT = 20;
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const LEGACY_SENTINEL_SUBJECT = "[TP] Project Index";
const PROJECT_ID_EXTENDED_PROPERTY_ID = "String {f4a0b90d-bf6d-4a31-a38d-7f2cdb9b6d22} Name trainingPlannerProjectId";

let msalInstance = null;
let msalInitPromise = null;
let lastPopupDismissedAt = 0;
let lastMsalError = null;
const scriptLoads = new Map();

function hasGraphConfig() {
  return Boolean(
    GRAPH_CLIENT_ID &&
      GRAPH_CLIENT_ID !== "YOUR_CLIENT_ID_HERE" &&
      GRAPH_TENANT_ID &&
      GRAPH_TENANT_ID !== "YOUR_TENANT_ID_HERE"
  );
}

function isMsalAvailable() {
  return Boolean(window.msal?.PublicClientApplication);
}

function loadScript(src) {
  if (scriptLoads.has(src)) return scriptLoads.get(src);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => (isMsalAvailable() ? resolve() : reject(new Error(`MSAL loaded from ${src} but is unavailable.`)));
    script.onerror = () => reject(new Error(`Failed to load MSAL from ${src}`));
    document.head.appendChild(script);
  });

  const tracked = promise.catch((error) => {
    scriptLoads.delete(src);
    throw error;
  });
  scriptLoads.set(src, tracked);
  return tracked;
}

function getErrorMessage(error, fallback = "Unknown error") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function createGraphAuthError(error, stage = "token acquisition") {
  const wrapped = new Error(`Microsoft Graph auth failed during ${stage}: ${getErrorMessage(error)}`);
  wrapped.name = "GraphAuthError";
  wrapped.code = error?.errorCode || error?.code || "";
  wrapped.stage = stage;
  wrapped.cause = error;
  return wrapped;
}

function isPopupDismissError(error) {
  const code = String(error?.errorCode || error?.code || "").toLowerCase();
  const message = getErrorMessage(error, "").toLowerCase();
  return (
    code === "user_cancelled"
    || code === "monitor_popup_timeout"
    || code === "empty_window_error"
    || message.includes("user cancelled")
    || message.includes("user canceled")
    || message.includes("popup window closed")
    || message.includes("popup closed")
  );
}

async function ensureMsalLoaded() {
  if (isMsalAvailable()) return;

  let lastError = null;
  for (const src of MSAL_CDN_URLS) {
    try {
      await loadScript(src);
      return;
    } catch (error) {
      lastError = error;
      console.warn("MSAL load attempt failed:", error);
    }
  }

  console.error("MSAL load failed:", lastError);
  throw lastError || new Error("MSAL could not be loaded.");
}

function createMsalInstance() {
  return new window.msal.PublicClientApplication({
    auth: {
      clientId: GRAPH_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${GRAPH_TENANT_ID}`,
      redirectUri: `${window.location.origin}${window.location.pathname}`,
    },
    cache: {
      cacheLocation: "sessionStorage",
    },
  });
}

async function initMsal() {
  if (!hasGraphConfig()) {
    setAuthStatus("error", "Missing Graph configuration");
    return null;
  }

  if (msalInstance) return msalInstance;
  if (msalInitPromise) return msalInitPromise;

  msalInitPromise = (async () => {
    setAuthStatus("loading");
    await ensureMsalLoaded();
    msalInstance = createMsalInstance();
    if (typeof msalInstance.initialize === "function") {
      await msalInstance.initialize();
    }

    if (typeof msalInstance.handleRedirectPromise === "function") {
      await msalInstance.handleRedirectPromise();
    }

    const accounts = msalInstance.getAllAccounts();
    if (accounts.length) {
      setGraphAccount(accounts[0]);
      setAuthStatus("ready");
    } else {
      setAuthStatus("idle");
    }
    lastMsalError = null;

    return msalInstance;
  })().catch((error) => {
    console.error("MSAL init failed:", error);
    setAuthStatus("error", error.message || String(error));
    lastMsalError = createGraphAuthError(error, "MSAL initialization");
    msalInstance = null;
    return null;
  }).finally(() => {
    msalInitPromise = null;
  });

  return msalInitPromise;
}

async function getAccessToken(scopes = GRAPH_SCOPES) {
  const instance = await initMsal();
  if (!instance) {
    if (lastMsalError) throw lastMsalError;
    return null;
  }
  if (!state.graphAccount) return null;

  try {
    const result = await instance.acquireTokenSilent({
      scopes,
      account: state.graphAccount,
    });
    lastMsalError = null;
    return result.accessToken;
  } catch (silentError) {
    console.warn("Silent token acquisition failed:", silentError);
    const elapsed = Date.now() - lastPopupDismissedAt;
    if (elapsed < 5000) return null;

    try {
      const result = await instance.acquireTokenPopup({
        scopes,
        account: state.graphAccount,
      });
      lastMsalError = null;
      return result.accessToken;
    } catch (popupError) {
      console.error("Popup token acquisition failed:", popupError);
      if (isPopupDismissError(popupError)) {
        lastPopupDismissedAt = Date.now();
        lastMsalError = null;
        return null;
      }
      lastMsalError = createGraphAuthError(popupError, "interactive token acquisition");
      throw lastMsalError;
    }
  }
}

function getGraphBase(userId = "me") {
  return userId === "me" ? `${GRAPH_ROOT}/me` : `${GRAPH_ROOT}/users/${encodeURIComponent(userId)}`;
}

export function normalizeCalendarEvents(rawEvents = [], source = {}) {
  const owner = source?.owner || "";

  return (rawEvents || [])
    .filter((event) => !event?.isCancelled)
    .filter((event) => String(event?.showAs || "").toLowerCase() !== "free")
    .filter((event) => !String(event?.subject || "").startsWith(SENTINEL_SUBJECT))
    .map((event) => ({
      id: `${owner}:${event.id}`,
      graphId: event.id,
      subject: event.subject || "Busy",
      start: event.start?.dateTime,
      end: event.end?.dateTime,
      showAs: String(event.showAs || "").toLowerCase(),
      calendarOwner: owner,
      kind: "calendar",
    }));
}

async function graphRequest(path, { method = "GET", body, headers = {}, extraHeaders = {}, scopes = GRAPH_SCOPES } = {}) {
  const token = await getAccessToken(scopes);
  if (!token) {
    throw new Error("Could not get a Microsoft Graph access token.");
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);

  try {
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...headers,
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({ error: { message: response.statusText } }));
      const error = new Error(errorPayload.error?.message || response.statusText);
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) return null;
    return response.json().catch(() => null);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getCurrentMonday() {
  const today = new Date();
  const monday = new Date(today);
  const day = monday.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function toIsoLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:00`;
}

function buildSentinelPayload(projects, options = {}) {
  const payload = {
    schemaId: SENTINEL_SCHEMA_ID,
    ...createSentinelPayload(projects, options),
  };

  return {
    "@odata.type": "microsoft.graph.openTypeExtension",
    extensionName: SENTINEL_SCHEMA_ID,
    schemaId: SENTINEL_SCHEMA_ID,
    payload: JSON.stringify(payload),
    projectCount: payload.projects.length,
    updatedAt: payload.updatedAt,
  };
}

function parseSentinelExtension(extension) {
  return parseSentinelProjects(extension);
}

async function findSentinelSeriesBySubject(subject, userId = "me", { exact = false } = {}) {
  const filter = exact ? `subject eq '${subject}'` : `startswith(subject,'${subject}')`;
  const path =
    `${getGraphBase(userId)}/events` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$top=${SENTINEL_LOOKBACK_COUNT}` +
    `&$select=id,subject,type,seriesMasterId,createdDateTime,start`;
  const data = await graphRequest(path);
  const events = data?.value || [];
  return events.find((event) => event.type === "seriesMaster") || null;
}

async function findSentinelSeries(userId = "me") {
  const current = await findSentinelSeriesBySubject(SENTINEL_SUBJECT, userId);
  if (current) return current;
  return findSentinelSeriesBySubject(LEGACY_SENTINEL_SUBJECT, userId, { exact: true });
}

async function createSentinelSeries(userId = "me") {
  const monday = getCurrentMonday();
  const endDate = new Date(monday);
  endDate.setDate(endDate.getDate() + 1);

  const event = {
    subject: SENTINEL_SUBJECT,
    isAllDay: true,
    showAs: "free",
    start: {
      dateTime: toIsoLocal(monday),
      timeZone: getLocalTimeZone(),
    },
    end: {
      dateTime: toIsoLocal(endDate),
      timeZone: getLocalTimeZone(),
    },
    recurrence: {
      pattern: {
        type: "weekly",
        interval: 1,
        daysOfWeek: ["monday"],
        firstDayOfWeek: "monday",
      },
      range: {
        type: "noEnd",
        startDate: `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`,
      },
    },
  };

  return graphRequest(`${getGraphBase(userId)}/events`, {
    method: "POST",
    body: event,
  });
}

async function renameSentinelSeries(masterId, userId = "me") {
  await graphRequest(`${getGraphBase(userId)}/events/${encodeURIComponent(masterId)}`, {
    method: "PATCH",
    body: {
      subject: SENTINEL_SUBJECT,
    },
  });
}

async function readSentinelExtension(masterId, userId = "me") {
  try {
    return await graphRequest(`${getGraphBase(userId)}/events/${encodeURIComponent(masterId)}/extensions/${encodeURIComponent(SENTINEL_SCHEMA_ID)}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function writeSentinelExtension(masterId, projects, userId = "me", options = {}) {
  const payload = buildSentinelPayload(projects, options);
  try {
    return await graphRequest(
      `${getGraphBase(userId)}/events/${encodeURIComponent(masterId)}/extensions/${encodeURIComponent(SENTINEL_SCHEMA_ID)}`,
      {
        method: "PATCH",
        body: payload,
      }
    );
  } catch (error) {
    if (error.status !== 404) throw error;
    return graphRequest(`${getGraphBase(userId)}/events/${encodeURIComponent(masterId)}/extensions`, {
      method: "POST",
      body: payload,
    });
  }
}

export async function ensureSentinelSeries(userId = "me") {
  let master = await findSentinelSeries(userId);
  if (!master) {
    master = await createSentinelSeries(userId);
  }
  return master;
}

export async function fetchSentinel({
  userId = "me",
  createIfMissing = userId === "me",
  ensureSentinelSeriesImpl = ensureSentinelSeries,
  findSentinelSeriesImpl = findSentinelSeries,
  readSentinelExtensionImpl = readSentinelExtension,
  writeSentinelExtensionImpl = writeSentinelExtension,
} = {}) {
  const master = createIfMissing
    ? await ensureSentinelSeriesImpl(userId)
    : await findSentinelSeriesImpl(userId);

  if (!master) {
    return {
      master: null,
      projects: [],
    };
  }

  const extension = await readSentinelExtensionImpl(master.id, userId);

  if (userId === "me") {
    setSentinelState({
      status: "ready",
      eventId: master.id,
      seriesMasterId: master.id,
      extensionId: extension?.id || SENTINEL_SCHEMA_ID,
      malformed: false,
      error: "",
      loadedAt: new Date().toISOString(),
    });
  }

  if (!extension) {
    if (!createIfMissing) {
      return {
        master,
        projects: [],
      };
    }

    await writeSentinelExtensionImpl(master.id, [], userId);
    return {
      master,
      projects: [],
    };
  }

  const projects = parseSentinelExtension(extension);
  return {
    master,
    projects,
  };
}

export async function readSentinelReadOnly({ userId = "me", ...options } = {}) {
  return fetchSentinel({
    userId,
    createIfMissing: false,
    ...options,
  });
}

function getSentinelMailbox(userId = "me", mailbox = "") {
  if (mailbox) return String(mailbox || "").trim().toLowerCase();
  if (userId !== "me") return String(userId || "").trim().toLowerCase();
  return String(state.graphAccount?.username || "").trim().toLowerCase();
}

export async function writeSentinel(projects, { userId = "me", mailbox = "", perspective = "" } = {}) {
  const master = await ensureSentinelSeries(userId);
  if (master.subject === LEGACY_SENTINEL_SUBJECT) {
    await renameSentinelSeries(master.id, userId);
    master.subject = SENTINEL_SUBJECT;
  }
  const sentinelMailbox = getSentinelMailbox(userId, mailbox);
  await writeSentinelExtension(master.id, projects, userId, {
    mailbox: sentinelMailbox,
    perspective,
  });
  if (userId === "me") {
    setSentinelState({
      status: "ready",
      eventId: master.id,
      seriesMasterId: master.id,
      extensionId: SENTINEL_SCHEMA_ID,
      malformed: false,
      error: "",
      loadedAt: new Date().toISOString(),
    });
  }
  return master;
}

export async function resetSentinel() {
  try {
    setSentinelState({ status: "loading", error: "", malformed: false });
    await writeSentinel([]);
    setProjects([]);
    setActiveProject("");
    setScreen("projects");
    toast("Sentinel reset");
  } catch (error) {
    console.error("Sentinel reset failed:", error);
    setProjectError("Could not reset the project sentinel.", error.message || String(error));
  }
}

export async function loadProjectsFromSentinel() {
  if (!state.graphAccount) return [];

  try {
    setSentinelState({ status: "loading", error: "", malformed: false });
    const { projects } = await fetchSentinel();
    setProjects(projects);
    if (!state.activeProjectId && projects.length) {
      setActiveProject(projects[0].id);
    }
    setScreen(state.deepLink.payload ? "workspace" : "projects");
    return projects;
  } catch (error) {
    console.error("Sentinel bootstrap failed:", error);
    setSentinelState({
      status: "error",
      error: error.message || String(error),
      malformed: true,
    });
    setProjectError("Could not load projects from the calendar sentinel.", error.message || String(error));
    setScreen("projects");
    return [];
  }
}

export async function persistActiveProjects() {
  await writeSentinel(state.projects);
}

export async function searchPeople(query) {
  if (!query?.trim()) {
    state.ui.peopleMatches = [];
    state.ui.peopleStatus = "idle";
    return [];
  }

  state.ui.peopleStatus = "loading";
  state.ui.peopleError = "";
  try {
    const response = await graphRequest(
      `${getGraphBase()}/people?$search=${encodeURIComponent(`"${query.trim()}"`)}&$top=8`,
      {
        scopes: GRAPH_SCOPES,
        extraHeaders: {
          ConsistencyLevel: "eventual",
        },
      }
    );
    const matches = (response?.value || [])
      .map((person) => ({
        name: person.displayName || person.userPrincipalName || "",
        email:
          person.scoredEmailAddresses?.find((item) => item.address)?.address ||
          person.userPrincipalName ||
          "",
      }))
      .filter((person) => person.email);

    state.ui.peopleMatches = matches;
    state.ui.peopleStatus = "ready";
    return matches;
  } catch (error) {
    console.error("People lookup failed:", error);
    state.ui.peopleStatus = "error";
    state.ui.peopleError = error.message || String(error);
    state.ui.peopleMatches = [];
    return [];
  }
}

export function buildEventPayload(project, session) {
  const [year, month, day] = session.date.split("-").map(Number);
  const [hours, minutes] = session.time.split(":").map(Number);
  const start = new Date(year, month - 1, day, hours, minutes, 0);
  const end = new Date(start.getTime() + session.duration * 60000);
  const event = {
    subject: buildSubject(project, session),
    body: {
      contentType: "html",
      content: buildBodyHTML(project, session),
    },
    start: {
      dateTime: toIsoLocal(start),
      timeZone: getLocalTimeZone(),
    },
    end: {
      dateTime: toIsoLocal(end),
      timeZone: getLocalTimeZone(),
    },
    location: project.location ? { displayName: project.location } : undefined,
    isOnlineMeeting: false,
  };

  if (session.type === "external") {
    const attendees = parseInvitees(project.invitees);
    if (attendees.length) {
      event.attendees = attendees.map((email) => ({
        emailAddress: { address: email },
        type: "required",
      }));
    }
  }

  if (session.owner === "is" && project?.id) {
    event.singleValueExtendedProperties = [
      {
        id: PROJECT_ID_EXTENDED_PROPERTY_ID,
        value: String(project.id),
      },
    ];
  }

  return event;
}

async function pushGraphEvent(session, project) {
  const url = session.graphEventId
    ? `${getGraphBase()}/events/${encodeURIComponent(session.graphEventId)}`
    : `${getGraphBase()}/events`;
  const method = session.graphEventId ? "PATCH" : "POST";
  const payload = buildEventPayload(project, session);

  try {
    return await graphRequest(url, {
      method,
      body: payload,
      headers: {
        Prefer: "return=representation",
      },
    });
  } catch (error) {
    if (session.graphEventId && [401, 403, 404, 410].includes(error.status)) {
      session.graphEventId = "";
      return graphRequest(`${getGraphBase()}/events`, {
        method: "POST",
        body: payload,
        headers: {
          Prefer: "return=representation",
        },
      });
    }
    throw error;
  }
}

export function __setMsalTestState({ instance = null, account = null, popupDismissedAt = 0, error = null } = {}) {
  msalInstance = instance;
  msalInitPromise = null;
  lastPopupDismissedAt = popupDismissedAt;
  lastMsalError = error;
  setGraphAccount(account);
}

export async function __graphRequestForTests(path, options = {}) {
  return graphRequest(path, options);
}

export async function __writeSentinelExtensionForTests(masterId, projects, userId = "me", options = {}) {
  return writeSentinelExtension(masterId, projects, userId, options);
}

export async function __pushGraphEventForTests(session, project) {
  return pushGraphEvent(session, project);
}

function chunkArray(items = [], size = GRAPH_BATCH_LIMIT) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildBatchUserPath(userId = "me") {
  return userId === "me" ? "/me" : `/users/${encodeURIComponent(userId)}`;
}

function buildSessionStartValue(session) {
  if (!session?.date || !session?.time) return "";
  return `${session.date}T${session.time}:00`;
}

function buildSessionEndValue(session) {
  if (!session?.date || !session?.time) return "";
  const [year, month, day] = String(session.date).split("-").map(Number);
  const [hours, minutes] = String(session.time).split(":").map(Number);
  const start = new Date(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0, 0);
  const end = new Date(start.getTime() + (Number(session.duration) || 0) * 60000);
  return toIsoLocal(end);
}

function getSessionExpectedWindow(session) {
  return {
    start: session?.lastKnownStart || buildSessionStartValue(session),
    end: session?.lastKnownEnd || buildSessionEndValue(session),
  };
}

function extractGraphDateParts(value = "") {
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return {
    date: match?.[1] || "",
    time: match?.[2] || "",
  };
}

function getDurationFromGraphWindow(startValue, endValue, fallback = 90) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (Number.isNaN(durationMinutes) || durationMinutes <= 0) {
    return Number(fallback) || 90;
  }
  return durationMinutes;
}

function applyGraphEventToSession(session, event = {}) {
  const liveStart = event.start?.dateTime || "";
  const liveEnd = event.end?.dateTime || "";
  const parts = extractGraphDateParts(liveStart);
  session.graphEventId = event.id || session.graphEventId;
  session.graphActioned = true;
  session.lastKnownStart = liveStart;
  session.lastKnownEnd = liveEnd;
  if (parts.date) session.date = parts.date;
  if (parts.time) session.time = parts.time;
  session.duration = getDurationFromGraphWindow(liveStart, liveEnd, session.duration);
  session.durationMinutes = session.duration;
}

async function batchFetchEventsById(eventIds = [], { userId = "me", graphRequestImpl = graphRequest } = {}) {
  const uniqueEventIds = [...new Set((eventIds || []).filter(Boolean))];
  const eventsById = new Map();
  if (!uniqueEventIds.length) return eventsById;

  const basePath = buildBatchUserPath(userId);
  for (const chunk of chunkArray(uniqueEventIds)) {
    const response = await graphRequestImpl(`${GRAPH_ROOT}/$batch`, {
      method: "POST",
      body: {
        requests: chunk.map((eventId, index) => ({
          id: String(index),
          method: "GET",
          url: `${basePath}/events/${encodeURIComponent(eventId)}?$select=id,start,end`,
          headers: {
            Prefer: `outlook.timezone="${getLocalTimeZone()}"`,
          },
        })),
      },
    });

    for (const item of response?.responses || []) {
      const eventId = chunk[Number(item.id)];
      if (!eventId) continue;
      if (item.status === 200) {
        eventsById.set(eventId, item.body || null);
        continue;
      }
      if (item.status === 404 || item.status === 410) {
        eventsById.set(eventId, null);
        continue;
      }

      const error = new Error(item.body?.error?.message || `Batch event lookup failed with status ${item.status}`);
      error.status = item.status;
      throw error;
    }
  }

  return eventsById;
}

function setProjectReconciliationSuccess(project, stateValue, attemptedAt) {
  project.reconciliation = project.reconciliation || {};
  project.reconciliation.lastAttemptedAt = attemptedAt;
  project.reconciliation.lastSuccessfulAt = attemptedAt;
  project.reconciliation.lastFailureAt = "";
  project.reconciliation.lastFailureMessage = "";
  project.reconciliation.state = stateValue;
  project.reconciliationState = stateValue;
  syncProjectRuntimeState(project);
}

function setProjectReconciliationFailure(project, error, attemptedAt) {
  const message = error?.message || String(error);
  project.reconciliation = project.reconciliation || {};
  project.reconciliation.lastAttemptedAt = attemptedAt;
  project.reconciliation.lastFailureAt = attemptedAt;
  project.reconciliation.lastFailureMessage = message;
  project.reconciliation.state = "refresh_failed";
  project.reconciliationState = "refresh_failed";
  syncProjectRuntimeState(project);
}

function reconcileIsProjectWithEvents(project, eventsById, attemptedAt) {
  const implementationSessions = getPhaseSessions(project, "implementation").filter((session) => session.graphEventId);
  if (!implementationSessions.length) return false;

  let driftDetected = false;
  for (const session of implementationSessions) {
    const liveEvent = eventsById.get(session.graphEventId);
    if (!liveEvent) {
      session.graphActioned = false;
      driftDetected = true;
      continue;
    }

    const expectedWindow = getSessionExpectedWindow(session);
    const liveStart = liveEvent.start?.dateTime || "";
    const liveEnd = liveEvent.end?.dateTime || "";
    if (
      (expectedWindow.start && liveStart && expectedWindow.start !== liveStart)
      || (expectedWindow.end && liveEnd && expectedWindow.end !== liveEnd)
    ) {
      driftDetected = true;
    }

    applyGraphEventToSession(session, liveEvent);
  }

  setProjectReconciliationSuccess(project, driftDetected ? "drift_detected" : "in_sync", attemptedAt);
  return driftDetected;
}

export async function reconcileIsProjects({
  projects = state.projects,
  userId = "me",
  graphRequestImpl = graphRequest,
  persistProjectsImpl = persistActiveProjects,
} = {}) {
  const applicableProjects = (projects || []).filter((project) =>
    getPhaseSessions(project, "implementation").some((session) => session.graphEventId)
  );
  if (!applicableProjects.length) {
    return {
      reconciledCount: 0,
      driftedCount: 0,
      failed: false,
    };
  }

  const attemptedAt = new Date().toISOString();

  try {
    const eventIds = applicableProjects.flatMap((project) =>
      getPhaseSessions(project, "implementation")
        .map((session) => session.graphEventId)
        .filter(Boolean)
    );
    const eventsById = await batchFetchEventsById(eventIds, { userId, graphRequestImpl });
    let driftedCount = 0;
    for (const project of applicableProjects) {
      if (reconcileIsProjectWithEvents(project, eventsById, attemptedAt)) {
        driftedCount += 1;
      }
    }

    await persistProjectsImpl();
    return {
      reconciledCount: applicableProjects.length,
      driftedCount,
      failed: false,
    };
  } catch (error) {
    for (const project of applicableProjects) {
      setProjectReconciliationFailure(project, error, attemptedAt);
    }
    await persistProjectsImpl();
    return {
      reconciledCount: applicableProjects.length,
      driftedCount: 0,
      failed: true,
      error,
    };
  }
}

function updateProjectCollection(projects, nextProject) {
  const index = (projects || []).findIndex((project) => project.id === nextProject.id);
  if (index >= 0) {
    projects[index] = nextProject;
  }
  replaceProject(nextProject.id, nextProject);
}

function projectNeedsPmReconciliation(project) {
  return Boolean(project?.handoff?.sentAt && project?.isEmail && !project?.closedAt);
}

function getPmSparseImplementationPhase(project) {
  return buildSentinelProjectRecord(project, { perspective: "pm" }).phases.implementation || {};
}

function buildPmPendingProject(project, attemptedAt) {
  return normalizeProject({
    ...project,
    phases: {
      setup: project.phases?.setup || {},
      implementation: getPmSparseImplementationPhase(project),
      hypercare: project.phases?.hypercare || {},
    },
    lifecycleState: project.closedAt ? "closed" : "handed_off_pending_is",
    reconciliation: {
      ...(project.reconciliation || {}),
      lastAttemptedAt: attemptedAt,
      lastSuccessfulAt: attemptedAt,
      lastFailureAt: "",
      lastFailureMessage: "",
      state: "not_applicable",
    },
    reconciliationState: "not_applicable",
    isCommittedAt: "",
    completedAt: "",
  });
}

function buildPmProjectFromIsAuthority(project, isProject, attemptedAt) {
  const nextState = isProject.reconciliationState || isProject.reconciliation?.state || "not_applicable";
  return normalizeProject({
    ...project,
    phases: {
      setup: project.phases?.setup || {},
      implementation: isProject.phases?.implementation || {},
      hypercare: project.phases?.hypercare || {},
    },
    lifecycleState: project.closedAt ? "closed" : "is_active",
    reconciliation: {
      ...(project.reconciliation || {}),
      lastAttemptedAt: attemptedAt,
      lastSuccessfulAt: attemptedAt,
      lastFailureAt: "",
      lastFailureMessage: "",
      state: nextState,
    },
    reconciliationState: nextState,
    isCommittedAt: "",
    completedAt: "",
  });
}

function buildPmRefreshFailedProject(project, error, attemptedAt) {
  const nextProject = normalizeProject({
    ...project,
    phases: {
      setup: project.phases?.setup || {},
      implementation: getPmSparseImplementationPhase(project),
      hypercare: project.phases?.hypercare || {},
    },
    lifecycleState: project.closedAt ? "closed" : project.lifecycleState || project.status || "handed_off_pending_is",
    reconciliation: {
      ...(project.reconciliation || {}),
      lastAttemptedAt: attemptedAt,
      lastFailureAt: attemptedAt,
      lastFailureMessage: error?.message || String(error),
      state: "refresh_failed",
    },
    reconciliationState: "refresh_failed",
    isCommittedAt: "",
    completedAt: "",
  });
  nextProject.reconciliation.lastSuccessfulAt = project.reconciliation?.lastSuccessfulAt || "";
  return nextProject;
}

export async function reconcilePmProjects({
  projects = state.projects,
  projectIds = [],
  readSentinelImpl = readSentinelReadOnly,
  persistProjectsImpl = persistActiveProjects,
} = {}) {
  const selectedProjectIds = new Set((projectIds || []).filter(Boolean));
  const applicableProjects = (projects || []).filter(
    (project) => projectNeedsPmReconciliation(project) && (!selectedProjectIds.size || selectedProjectIds.has(project.id))
  );
  if (!applicableProjects.length) {
    return {
      reconciledCount: 0,
      pendingCount: 0,
      failedCount: 0,
    };
  }

  const attemptedAt = new Date().toISOString();
  const mailboxGroups = new Map();
  for (const project of applicableProjects) {
    const mailbox = normalizeEmailAddress(project.isEmail);
    if (!mailboxGroups.has(mailbox)) mailboxGroups.set(mailbox, []);
    mailboxGroups.get(mailbox).push(project);
  }

  let reconciledCount = 0;
  let pendingCount = 0;
  let failedCount = 0;

  for (const [mailbox, mailboxProjects] of mailboxGroups.entries()) {
    try {
      const { projects: foreignProjects } = await readSentinelImpl({ userId: mailbox });
      const foreignProjectMap = new Map((foreignProjects || []).map((project) => [project.id, project]));

      for (const project of mailboxProjects) {
        const authoritativeProject = foreignProjectMap.get(project.id);
        const nextProject = authoritativeProject
          ? buildPmProjectFromIsAuthority(project, authoritativeProject, attemptedAt)
          : buildPmPendingProject(project, attemptedAt);
        updateProjectCollection(projects, nextProject);
        if (authoritativeProject) {
          reconciledCount += 1;
        } else {
          pendingCount += 1;
        }
      }
    } catch (error) {
      for (const project of mailboxProjects) {
        const nextProject = buildPmRefreshFailedProject(project, error, attemptedAt);
        updateProjectCollection(projects, nextProject);
        failedCount += 1;
      }
    }
  }

  await persistProjectsImpl();
  return {
    reconciledCount,
    pendingCount,
    failedCount,
  };
}

function normalizeEmailAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function buildSharedCalendarOption(calendar = {}) {
  const ownerEmail = normalizeEmailAddress(calendar?.owner?.address);
  const ownerName = String(calendar?.owner?.name || ownerEmail || "").trim();
  const calendarName = String(calendar?.name || "").trim();
  const primaryLike = Boolean(ownerName) && normalizeEmailAddress(calendarName) === normalizeEmailAddress(ownerName);
  const label = primaryLike || !calendarName
    ? `${ownerName || ownerEmail} | ${ownerEmail}`
    : `${ownerName || ownerEmail} | ${calendarName} | ${ownerEmail}`;
  return {
    id: String(calendar?.id || ""),
    name: calendarName,
    ownerName,
    ownerEmail,
    canEdit: Boolean(calendar?.canEdit),
    isPrimaryLike: primaryLike,
    label,
  };
}

export async function loadSharedCalendars() {
  state.ui.sharedCalendarOptions = [];
  state.ui.sharedCalendarStatus = "loading";
  state.ui.sharedCalendarError = "";

  try {
    const ownEmail = normalizeEmailAddress(state.graphAccount?.username);
    const calendars = [];
    let nextLink = `${getGraphBase()}/calendars`;

    while (nextLink) {
      const response = await graphRequest(nextLink, {
        scopes: GRAPH_SCOPES,
      });
      calendars.push(...(response?.value || []));
      nextLink = response?.["@odata.nextLink"] || "";
    }

    const options = calendars
      .map((calendar) => buildSharedCalendarOption(calendar))
      .filter((calendar) => calendar.id && calendar.ownerEmail && calendar.ownerEmail !== ownEmail)
      .sort((left, right) => {
        if (left.isPrimaryLike !== right.isPrimaryLike) return left.isPrimaryLike ? -1 : 1;
        if (left.canEdit !== right.canEdit) return left.canEdit ? -1 : 1;
        return left.label.localeCompare(right.label);
      });

    state.ui.sharedCalendarOptions = options;
    state.ui.sharedCalendarStatus = "ready";
    if (!options.some((calendar) => calendar.id === state.ui.selectedSharedCalendarId)) {
      state.ui.selectedSharedCalendarId = "";
    }
    return options;
  } catch (error) {
    console.error("Shared calendar lookup failed:", error);
    state.ui.sharedCalendarStatus = "error";
    state.ui.sharedCalendarError = error.message || String(error);
    state.ui.sharedCalendarOptions = [];
    state.ui.selectedSharedCalendarId = "";
    return [];
  }
}

function snapshotSessionPushState(session) {
  return {
    graphEventId: session.graphEventId,
    graphActioned: session.graphActioned,
  };
}

function applySessionPushResult(session, payload) {
  if (payload?.id) {
    session.graphEventId = payload.id;
  }
  session.graphActioned = true;
}

function restoreSessionPushState(session, snapshot) {
  session.graphEventId = snapshot.graphEventId;
  session.graphActioned = snapshot.graphActioned;
}

export async function pushSessionToCalendar(
  sessionId,
  {
    project = getActiveProject(),
    persist = true,
    notify = true,
    pushGraphEventImpl = pushGraphEvent,
    persistActiveProjectsImpl = persistActiveProjects,
    toastImpl = toast,
  } = {}
) {
  if (!project) return false;
  const found = findSession(project, sessionId);
  if (!found?.session || !found.session.date || !found.session.time) {
    if (notify) {
      toastImpl("Set a date and time first");
    }
    return false;
  }

  try {
    const previousState = snapshotSessionPushState(found.session);
    const payload = await pushGraphEventImpl(found.session, project);
    applySessionPushResult(found.session, payload);
    project.status = deriveProjectStatus(project);

    if (persist) {
      try {
        await persistActiveProjectsImpl();
      } catch (persistError) {
        restoreSessionPushState(found.session, previousState);
        project.status = deriveProjectStatus(project);
        throw persistError;
      }
    }

    if (notify) {
      toastImpl(`"${found.session.name}" synced to calendar`, 3500);
    }
    return true;
  } catch (error) {
    console.error("pushSessionToCalendar failed:", error);
    if (notify) {
      toastImpl(`Graph error: ${error.message || error}`, 5000);
    }
    return false;
  }
}

export async function fetchCalendarEvents({ project = getActiveProject(), startDate = "", endDate = "" } = {}) {
  if (!project) {
    setCalendarEvents([]);
    resetCalendarAvailability();
    return [];
  }

  const projectRange = getProjectDateRange(project) || {};
  const range = {
    ...projectRange,
    start: startDate || projectRange.start,
    end: endDate || projectRange.end,
  };
  const plan = getCalendarFetchPlan({ project, actor: state.actor });
  const pmSource = plan.sources.find((source) => source.owner === "pm");
  const isSource = plan.sources.find((source) => source.owner === "is");
  const initialWarnings = [...plan.warnings];
  const initialSourceState = {
    pm: {
      status: pmSource ? "loading" : "idle",
      userId: pmSource?.userId || "me",
      mailbox: pmSource?.mailbox || "",
      loadedAt: "",
      error: "",
      errorCode: "",
    },
    is: {
      status: initialWarnings.some((warning) => warning.owner === "is")
        ? "blocked"
        : isSource
          ? "loading"
          : "idle",
      userId: isSource?.userId || "",
      mailbox: isSource?.mailbox || String(project.isEmail || "").trim().toLowerCase(),
      loadedAt: "",
      error: initialWarnings.find((warning) => warning.owner === "is")?.message || "",
      errorCode: initialWarnings.find((warning) => warning.owner === "is")?.code || "",
    },
  };
  setCalendarEvents([]);
  resetCalendarAvailability({
    projectId: project.id,
    rangeStart: range.start,
    rangeEnd: range.end,
    warnings: initialWarnings,
    sources: initialSourceState,
  });

  function buildCalendarViewPath(userId) {
    return `${getGraphBase(userId)}/calendarView` +
    `?startDateTime=${encodeURIComponent(`${range.start}T00:00:00`)}` +
    `&endDateTime=${encodeURIComponent(`${range.end}T23:59:59`)}` +
    `&$select=id,subject,start,end,isCancelled,showAs` +
    `&$top=250`;
  }

  async function fetchSourceEvents(source) {
    let nextLink = buildCalendarViewPath(source.userId);
    const rawEvents = [];
    while (nextLink) {
      const data = await graphRequest(nextLink, {
        extraHeaders: {
          Prefer: `outlook.timezone="${getLocalTimeZone()}"`,
        },
      });
      rawEvents.push(...(data?.value || []));
      nextLink = data?.["@odata.nextLink"] || "";
    }

    return normalizeCalendarEvents(rawEvents, source);
  }

  const results = await Promise.all(
    plan.sources.map(async (source) => {
      try {
        const events = await fetchSourceEvents(source);
        return {
          source,
          events,
          warning: null,
        };
      } catch (error) {
        console.error(`fetchCalendarEvents failed for ${source.owner}:`, error);
        return {
          source,
          events: [],
          warning: classifyCalendarSourceError({
            owner: source.owner,
            error,
            actor: state.actor,
            project,
          }),
        };
      }
    })
  );

  const warnings = [...initialWarnings];
  const nextSources = {
    ...initialSourceState,
  };
  const events = [];

  for (const result of results) {
    if (result.warning) {
      warnings.push(result.warning);
      nextSources[result.source.owner] = {
        ...nextSources[result.source.owner],
        status: result.warning.blocking ? "blocked" : "error",
        loadedAt: "",
        error: result.warning.message,
        errorCode: result.warning.code,
      };
      continue;
    }

    events.push(...result.events);
    nextSources[result.source.owner] = {
      ...nextSources[result.source.owner],
      status: "ready",
      loadedAt: new Date().toISOString(),
      error: "",
      errorCode: "",
    };
  }

  setCalendarEvents(events);
  resetCalendarAvailability({
    projectId: project.id,
    rangeStart: range.start,
    rangeEnd: range.end,
    warnings,
    sources: nextSources,
  });
  return events;
}

export async function pushOwnedSessions({
  actor = state.actor,
  project = getActiveProject(),
  pushSessionToCalendarImpl = pushSessionToCalendar,
  persistActiveProjectsImpl = persistActiveProjects,
  fetchCalendarEventsImpl = fetchCalendarEvents,
  toastImpl = toast,
} = {}) {
  if (!project) return 0;

  const sessions = getPushableSessions(project, actor);
  if (!sessions.length) {
    toastImpl(actor === "is" ? "No implementation sessions are ready to commit" : "No sessions are ready to push");
    return 0;
  }

  let pushed = 0;
  for (const session of sessions) {
    const result = await pushSessionToCalendarImpl(session.id, { project, persist: false, notify: false });
    if (result) pushed += 1;
  }

  if (pushed) {
    if (actor === "is") {
      project.isCommittedAt = project.isCommittedAt || new Date().toISOString();
    }
    project.status = deriveProjectStatus(project);

    try {
      await persistActiveProjectsImpl();
    } catch (error) {
      console.error("Batch push persistence failed:", error);
      toastImpl(`Calendar updated, but project index could not be saved: ${error.message || error}`, 6000);
      await fetchCalendarEventsImpl({ project });
      return pushed;
    }

    if (actor === "is") {
      syncProjectRuntimeState(project);
    }
  }

  await fetchCalendarEventsImpl({ project });
  return pushed;
}

export function buildHandoffBody(project, deepLinkUrl) {
  const implementationCount = getPhaseSessions(project, "implementation").length;
  return `<!DOCTYPE html>
<html>
<body style="font-family:'Trebuchet MS','Segoe UI',sans-serif;font-size:14px;color:#1f2933;">
  <h2 style="margin-bottom:8px;">${esc(project.clientName || "Project")} Implementation Handoff</h2>
  <p>The implementation phase is ready for review.</p>
  <ul>
    <li>Implementation window: ${esc(project.implementationStart || "TBC")} to ${esc(project.goLiveDate || "TBC")}</li>
    <li>Implementation sessions: ${esc(implementationCount)}</li>
    <li>Calendar owner: ${esc(project.isName || project.isEmail || "Implementation Specialist")}</li>
  </ul>
  <p><a href="${esc(deepLinkUrl)}">Open this project in Training Planner</a></p>
</body>
</html>`;
}

function buildHandoffEvent(project, deepLinkUrl) {
  const baseDate = project.implementationStart || new Date().toISOString().slice(0, 10);
  const start = new Date(`${baseDate}T09:00:00`);
  const end = new Date(start.getTime() + 30 * 60000);

  return {
    subject: `${buildSubject(project, { name: "Implementation Handoff", phase: "implementation" })}`,
    body: {
      contentType: "html",
      content: buildHandoffBody(project, deepLinkUrl),
    },
    start: {
      dateTime: toIsoLocal(start),
      timeZone: getLocalTimeZone(),
    },
    end: {
      dateTime: toIsoLocal(end),
      timeZone: getLocalTimeZone(),
    },
    location: project.location ? { displayName: project.location } : undefined,
    attendees: project.isEmail
      ? [
          {
            emailAddress: {
              address: project.isEmail,
              name: project.isName || project.isEmail,
            },
            type: "required",
          },
        ]
      : undefined,
  };
}

export async function createHandoffEvent(
  project = getActiveProject(),
  {
    buildDeepLinkUrlImpl = buildDeepLinkUrl,
    graphRequestImpl = graphRequest,
    persistActiveProjectsImpl = persistActiveProjects,
    toastImpl = toast,
  } = {}
) {
  if (!project) return null;

  const { url, length, warn } = buildDeepLinkUrlImpl(project);
  if (warn) {
    toastImpl(`Deep link may be too long for some clients (${length}/${DEEP_LINK_LIMIT})`, 5000);
  }

  const eventPayload = buildHandoffEvent(project, url);
  const createdEvent = await graphRequestImpl(`${getGraphBase()}/events`, {
    method: "POST",
    body: eventPayload,
  });

  project.handoff = {
    sentAt: new Date().toISOString(),
    delegateUsed: false,
    deepLinkUrl: url,
    deepLinkLength: length,
    eventId: createdEvent?.id || "",
  };
  syncProjectRuntimeState(project);
  await persistActiveProjectsImpl();
  state.ui.lastHandoff = {
    url,
    length,
    delegateUsed: false,
    eventId: createdEvent?.id || "",
  };
  return state.ui.lastHandoff;
}

export async function applyDeepLinkProject(
  payload,
  {
    persistActiveProjectsImpl = persistActiveProjects,
  } = {}
) {
  const incomingProject = normalizeProject({
    id: payload.id,
    clientName: payload.c,
    projectType: payload.pt || payload.templateOriginKey || payload.templateKey,
    templateKey: payload.templateKey || payload.tk || payload.pt,
    templateLabel: payload.templateLabel || payload.tl || "",
    templateCustomized: Boolean(payload.templateCustomized || payload.tc || payload.templateSnapshot || payload.ts),
    templateOriginKey: payload.templateOriginKey || payload.to || payload.pt || payload.tk,
    templateSnapshot: payload.templateSnapshot || payload.ts || null,
    pmEmail: payload.pm,
    pmName: payload.pn,
    isEmail: payload.is,
    isName: payload.in,
    projectStart: payload.projectStart || payload.ps || "",
    implementationStart: payload.s,
    goLiveDate: payload.g,
    hypercareDuration: payload.h,
    location: payload.l,
    invitees: payload.a,
    phases: {
      implementation: {
        owner: "is",
        stages: (payload.impl || []).map((stage, stageIndex) => ({
          key: stage.key,
          label: stage.label,
          order: stageIndex,
          sessions: (stage.sessions || []).map((session, sessionIndex) => ({
            ...session,
            phase: "implementation",
            owner: "is",
            stageKey: stage.key,
            order: Number.isFinite(session.order) ? Number(session.order) : sessionIndex,
            })),
        })),
      },
    },
  });

  const existing = getProjectById(state.projects, incomingProject.id);
  if (existing) {
    setActiveProject(existing.id);
    setActorMode("is", "is");
    setScreen("workspace");
    return existing;
  }

  upsertProject(incomingProject);
  setActiveProject(incomingProject.id);
  setActorMode("is", "is");
  setScreen("workspace");
  await persistActiveProjectsImpl();
  return incomingProject;
}

async function deleteGraphEvent(eventId) {
  if (!eventId) return false;
  try {
    await graphRequest(`${getGraphBase()}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    return true;
  } catch (error) {
    if ([404, 410].includes(error.status)) return true;
    console.error(`deleteGraphEvent failed for ${eventId}:`, error);
    return false;
  }
}

export async function deleteFutureProjectEvents(project) {
  const today = toDateStr(new Date());
  const futureSessions = getAllSessions(project).filter(
    (session) => session.graphEventId && session.date && session.date >= today
  );
  let deleted = 0;
  let failed = 0;
  for (const session of futureSessions) {
    if (await deleteGraphEvent(session.graphEventId)) {
      session.graphEventId = "";
      session.graphActioned = false;
      deleted += 1;
    } else {
      failed += 1;
    }
  }
  return { deleted, failed, total: futureSessions.length };
}

export function buildCloseNotificationBody(project, closedDate = "today") {
  return `<!DOCTYPE html>
<html><body style="font-family:'Trebuchet MS','Segoe UI',sans-serif;font-size:14px;color:#1f2933;">
<h2>${esc(project.clientName || "Project")} - Closed</h2>
<p>This project was closed by <strong>${esc(project.closedBy || "the Project Manager")}</strong> on ${esc(closedDate)}.</p>
<p>Future calendar events from the PM's calendar have been removed. Please review your own calendar and remove any remaining sessions for this project.</p>
</body></html>`;
}

async function createCloseNotificationEvent(project) {
  const subject = `${PRODUCT_NAME} | ${project.clientName || "Project"} | Project Closed`;
  const closedDate = project.closedAt ? new Date(project.closedAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : "today";
  const body = buildCloseNotificationBody(project, closedDate);
  const now = new Date();
  const end = new Date(now.getTime() + 15 * 60000);
  try {
    return await graphRequest(`${getGraphBase()}/events`, {
      method: "POST",
      body: {
        subject,
        body: { contentType: "html", content: body },
        start: { dateTime: toIsoLocal(now), timeZone: getLocalTimeZone() },
        end: { dateTime: toIsoLocal(end), timeZone: getLocalTimeZone() },
        showAs: "free",
        attendees: project.isEmail
          ? [{ emailAddress: { address: project.isEmail, name: project.isName || project.isEmail }, type: "required" }]
          : undefined,
      },
    });
  } catch (error) {
    console.error("Close notification event failed:", error);
    return null;
  }
}

export async function closeProject(project) {
  if (!project) throw new Error("No project to close");
  if (project.closedAt) throw new Error("Project is already closed");

  const deleteResult = await deleteFutureProjectEvents(project);
  project.closedAt = new Date().toISOString();
  project.closedBy = state.graphAccount?.name || "Project Manager";
  syncProjectRuntimeState(project);
  await persistActiveProjects();

  await Promise.allSettled([
    project.isEmail ? createCloseNotificationEvent(project) : Promise.resolve(null),
  ]);

  return deleteResult;
}

export async function toggleAuth() {
  if (!hasGraphConfig()) {
    toast("Add your Azure client and tenant IDs to enable Microsoft 365 sync.", 5000);
    return false;
  }

  const instance = await initMsal();
  if (!instance) return false;

  if (state.graphAccount) {
    await instance.logoutPopup({ account: state.graphAccount }).catch((error) => {
      console.error("Logout failed:", error);
    });
    setGraphAccount(null);
    setAuthStatus("idle");
    setProjects([]);
    setActiveProject("");
    setScreen("auth");
    return false;
  }

  try {
    setAuthStatus("loading");
    const result = await instance.loginPopup({
      scopes: GRAPH_SCOPES,
      prompt: "select_account",
    });
    setGraphAccount(result.account);
    setAuthStatus("ready");
    await loadProjectsFromSentinel();
    toast(`Connected as ${result.account.name || result.account.username}`, 3500);
    return true;
  } catch (error) {
    console.error("Login failed:", error);
    setAuthStatus("error", error.message || String(error));
    if (error.errorCode !== "user_cancelled") {
      toast(`Sign-in failed: ${error.message || error}`, 5000);
    }
    return false;
  }
}

export async function bootstrapMsal() {
  const instance = await initMsal();
  if (!instance) return null;

  if (state.graphAccount) {
    await loadProjectsFromSentinel();
  } else {
    setScreen("auth");
  }

  return instance;
}
