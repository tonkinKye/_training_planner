import { GRAPH_CLIENT_ID, GRAPH_TENANT_ID } from "./config.js";
import { buildBodyHTML, buildSubject, parseInvitees } from "./invites.js";
import { refreshRow, render } from "./render.js";
import {
  getScheduleRow,
  getSession,
  invalidateAllInviteState,
  saveState,
  setGraphAccount,
  state,
} from "./state.js";
import { getLocalTimeZone, pad, toast } from "./utils.js";
const GRAPH_SCOPES = ["Calendars.ReadWrite"];
const MSAL_CDN_URLS = [
  "https://alcdn.msauth.net/browser/2.39.0/js/msal-browser.min.js",
  "https://unpkg.com/@azure/msal-browser@2.39.0/lib/msal-browser.min.js",
];

const GRAPH_FETCH_TIMEOUT_MS = 30000;
const POPUP_COOLDOWN_MS = 5000;

let msalInstance = null;
let msalInitPromise = null;
let msalInitError = null;
let lastPopupDismissedAt = 0;
const msalScriptLoads = new Map();

function hasGraphConfig() {
  return Boolean(
    GRAPH_CLIENT_ID &&
      GRAPH_CLIENT_ID !== "YOUR_CLIENT_ID_HERE" &&
      GRAPH_TENANT_ID &&
      GRAPH_TENANT_ID !== "YOUR_TENANT_ID_HERE"
  );
}

function isMsalAvailable() {
  return Boolean(window.msal && window.msal.PublicClientApplication);
}

function loadExternalScript(src) {
  if (msalScriptLoads.has(src)) return msalScriptLoads.get(src);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.msalSrc = src;
    script.onload = () => {
      if (isMsalAvailable()) {
        console.info("MSAL loaded from", src);
        resolve();
      } else {
        reject(new Error(`MSAL loaded from ${src} but window.msal.PublicClientApplication is unavailable.`));
      }
    };
    script.onerror = () => reject(new Error(`Failed to load MSAL from ${src}`));
    document.head.appendChild(script);
  });

  const tracked = promise.catch((error) => {
    msalScriptLoads.delete(src);
    throw error;
  });
  msalScriptLoads.set(src, tracked);
  return tracked;
}

async function ensureMsalLoaded() {
  if (isMsalAvailable()) return;

  let lastError = null;
  for (const src of MSAL_CDN_URLS) {
    try {
      await loadExternalScript(src);
      return;
    } catch (error) {
      lastError = error;
      console.error("MSAL script load failed:", src, error);
    }
  }

  throw lastError || new Error("MSAL could not be loaded from any configured CDN.");
}

export function updateAuthUI() {
  const button = document.getElementById("authBtn");
  const label = document.getElementById("authLabel");
  const icon = document.getElementById("authIcon");
  if (!button || !label || !icon) return;

  if (state.graphAccount) {
    const initials = state.graphAccount.name
      ? state.graphAccount.name
          .split(" ")
          .map((word) => word[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()
      : "?";

    icon.outerHTML = `<span id="authIcon" class="auth-avatar">${initials}</span>`;
    label.textContent = state.graphAccount.name || state.graphAccount.username;
    button.classList.add("connected");
    button.title = `Signed in as ${state.graphAccount.username} - click to sign out`;
  } else {
    icon.outerHTML = '<span id="authIcon">☁️</span>';
    label.textContent = "Connect M365";
    button.classList.remove("connected");
    button.title = "";
  }
}

function setAuthButtonLoading(loading) {
  const button = document.getElementById("authBtn");
  if (!button) return;
  button.classList.toggle("loading", loading);
  if (loading) button.setAttribute("disabled", "");
  else button.removeAttribute("disabled");
}

export async function initMsal() {
  if (!hasGraphConfig()) {
    console.warn("MSAL init skipped: Graph client or tenant ID is missing.");
    return null;
  }

  if (msalInstance) return msalInstance;
  if (msalInitPromise) return msalInitPromise;

  msalInitPromise = (async () => {
    try {
      setAuthButtonLoading(true);
      if (window.__msalPrimaryScriptError) {
        console.error("Primary MSAL CDN failed before init. Trying fallback loader.");
      }

      await ensureMsalLoaded();

      if (!isMsalAvailable()) {
        throw new Error("MSAL library is not available on window.msal.");
      }

      const instance = new window.msal.PublicClientApplication({
        auth: {
          clientId: GRAPH_CLIENT_ID,
          authority: `https://login.microsoftonline.com/${GRAPH_TENANT_ID}`,
          redirectUri: `${window.location.origin}${window.location.pathname}`,
        },
        cache: { cacheLocation: "sessionStorage" },
      });

      if (typeof instance.initialize === "function") {
        await instance.initialize();
      }

      let redirectResult = null;
      if (typeof instance.handleRedirectPromise === "function") {
        redirectResult = await instance.handleRedirectPromise();
      }

      msalInstance = instance;
      msalInitError = null;

      if (redirectResult?.account) {
        setGraphAccount(redirectResult.account);
      } else {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length) setGraphAccount(accounts[0]);
      }

      updateAuthUI();
      render();
      console.info("MSAL initialised successfully.");
      return msalInstance;
    } catch (error) {
      msalInitError = error;
      msalInstance = null;
      console.error("MSAL init failed:", error);
      return null;
    } finally {
      setAuthButtonLoading(false);
      msalInitPromise = null;
    }
  })();

  return msalInitPromise;
}

export async function toggleAuth() {
  if (!hasGraphConfig()) {
    toast("Add your Azure Client ID and Tenant ID to enable M365 sync", 4000);
    return;
  }

  if (!msalInstance) {
    await initMsal();
  }

  if (!msalInstance) {
    toast(
      msalInitError
        ? "M365 sync could not start. Check the browser console for the MSAL error."
        : "M365 sync is still initialising. Please try again.",
      5000
    );
    return;
  }

  if (state.graphAccount) {
    try {
      await msalInstance.logoutPopup({ account: state.graphAccount });
    } catch (error) {
      console.error("MSAL logout failed:", error);
      toast(`Sign-out failed: ${error.message || error}`, 5000);
      return;
    }

    setGraphAccount(null);
    updateAuthUI();
    render();
    return;
  }

  await signIn();
}

async function signIn() {
  if (!msalInstance) return;

  try {
    const result = await msalInstance.loginPopup({
      scopes: GRAPH_SCOPES,
      prompt: "select_account",
    });
    const previousAccount = state.graphAccount;
    setGraphAccount(result.account);

    if (previousAccount && previousAccount.username !== result.account.username) {
      invalidateAllInviteState({ preserveGraphEventId: false });
    }

    updateAuthUI();
    render();
    toast(`Connected as ${state.graphAccount.name || state.graphAccount.username}`);
  } catch (error) {
    console.error("MSAL loginPopup failed:", error);
    if (error.errorCode !== "user_cancelled") {
      toast(`Sign-in failed: ${error.message || error}`, 5000);
    }
  }
}

async function getGraphToken() {
  if (!msalInstance) {
    await initMsal();
  }

  if (!msalInstance || !state.graphAccount) return null;

  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: GRAPH_SCOPES,
      account: state.graphAccount,
    });
    return result.accessToken;
  } catch (silentError) {
    console.warn("MSAL acquireTokenSilent failed, falling back to popup:", silentError);

    const elapsed = Date.now() - lastPopupDismissedAt;
    if (elapsed < POPUP_COOLDOWN_MS) {
      toast("Please wait a moment before retrying", 3000);
      return null;
    }

    try {
      const result = await msalInstance.acquireTokenPopup({
        scopes: GRAPH_SCOPES,
        account: state.graphAccount,
      });
      return result.accessToken;
    } catch (popupError) {
      lastPopupDismissedAt = Date.now();
      console.error("MSAL acquireTokenPopup failed:", popupError);
      toast(`Could not get calendar access: ${popupError.message || popupError}`, 5000);
      return null;
    }
  }
}

function buildEventPayload(session, row) {
  const location = document.getElementById("globalLocation")?.value.trim() || "";
  const attendees = parseInvitees();
  const bodyHtml = buildBodyHTML(session, row);

  const [year, month, day] = row.date.split("-").map(Number);
  const [hours, minutes] = row.time.split(":").map(Number);
  const start = new Date(year, month - 1, day, hours, minutes, 0);
  if (isNaN(start.getTime())) {
    throw new Error("Invalid date or time for this session. Check the values and try again.");
  }
  const end = new Date(start.getTime() + session.duration * 60000);
  const toLocalISO = (value) =>
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(
      value.getHours()
    )}:${pad(value.getMinutes())}:00`;

  const event = {
    subject: buildSubject(session.name),
    body: { contentType: "html", content: bodyHtml },
    start: { dateTime: toLocalISO(start), timeZone: getLocalTimeZone() },
    end: { dateTime: toLocalISO(end), timeZone: getLocalTimeZone() },
    isOnlineMeeting: false,
  };

  if (location) {
    event.location = { displayName: location };
  }

  if (attendees.length) {
    event.attendees = attendees.map((email) => ({
      emailAddress: { address: email },
      type: "required",
    }));
  }

  return event;
}

async function pushEventRequest(accessToken, row, eventPayload) {
  const isUpdate = Boolean(row.graphEventId);
  const url = isUpdate
    ? `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(row.graphEventId)}`
    : "https://graph.microsoft.com/v1.0/me/events";
  const method = isUpdate ? "PATCH" : "POST";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(eventPayload),
      signal: controller.signal,
    });
  } catch (fetchError) {
    if (fetchError.name === "AbortError") {
      throw new Error("Request timed out. Check your network and try again.");
    }
    throw fetchError;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorPayload = null;
    try {
      errorPayload = await response.json();
    } catch {
      errorPayload = { error: { message: response.statusText } };
    }

    const error = new Error(errorPayload.error?.message || response.statusText);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json().catch(() => null);
  return { isUpdate, payload };
}

export async function pushToCalendar(sessionId) {
  const session = getSession(sessionId);
  const row = getScheduleRow(sessionId);
  if (!session || !row || !row.date || !row.time) {
    toast("Set a date and time first");
    return;
  }

  const button = document.querySelector(`#ac-${sessionId} .lbtn-graph`);
  if (button) {
    button.classList.add("pushing");
    button.textContent = row.graphEventId ? "⏳ Updating..." : "⏳ Pushing...";
  }

  const accessToken = await getGraphToken();
  if (!accessToken) {
    toast("Could not get an access token. Try reconnecting M365.", 4000);
    refreshRow(sessionId);
    return;
  }

  const payload = buildEventPayload(session, row);

  try {
    let result;
    try {
      result = await pushEventRequest(accessToken, row, payload);
    } catch (error) {
      const retryStatuses = new Set([401, 403, 404, 410]);
      if (row.graphEventId && retryStatuses.has(error.status)) {
        console.warn(`Graph PATCH returned ${error.status}. Clearing stale event ID and creating new event.`, error);
        row.graphEventId = "";
        row.graphActioned = false;
        result = await pushEventRequest(accessToken, row, payload);
      } else {
        throw error;
      }
    }

    if (result.payload?.id) {
      row.graphEventId = result.payload.id;
    }

    row.graphActioned = true;
    saveState();
    refreshRow(sessionId);
    toast(
      result.isUpdate
        ? `"${session.name}" updated in your calendar`
        : `"${session.name}" added to your calendar`
    );
  } catch (error) {
    console.error("Graph push failed:", error);
    refreshRow(sessionId);
    toast(`Graph error: ${error.message}`, 5000);
  }
}

export function bootstrapMsal() {
  initMsal().catch((error) => {
    console.error("MSAL bootstrap failed:", error);
    toast("M365 connection unavailable. You can retry via the Connect button.", 5000);
  });
}
