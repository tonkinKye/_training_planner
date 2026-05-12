export const RUNTIME_CONFIG_GLOBAL = "__TRAINING_PLANNER_CONFIG__";

const DEFAULT_PRODUCT_NAME = "Fishbowl";
const DEFAULT_GRAPH_CLIENT_ID = "YOUR_CLIENT_ID_HERE";
const DEFAULT_GRAPH_TENANT_ID = "YOUR_TENANT_ID_GUID_HERE";
const DEFAULT_GRAPH_SCOPES = ["Calendars.ReadWrite", "Calendars.Read.Shared"];
const DEFAULT_ZOOM_CLIENT_ID = "YOUR_ZOOM_CLIENT_ID_HERE";
const DEFAULT_ZOOM_API_BASE = "https://api.zoom.us/v2";
const DEFAULT_ZOOM_OAUTH_BASE = "https://zoom.us/oauth";
const DEFAULT_ZOOM_SCOPES = [
  "meeting:write:meeting",
  "meeting:update:meeting",
  "meeting:delete:meeting",
  "user:read:user",
  "cloud_recording:read:list_user_recordings:admin",
  "cloud_recording:read:recording:admin",
  "meeting_summary:read:summary:admin",
];

function readRuntimeConfig() {
  if (typeof globalThis === "undefined") return {};
  const fromWindow =
    globalThis.window && typeof globalThis.window === "object"
      ? globalThis.window[RUNTIME_CONFIG_GLOBAL]
      : null;
  const fromGlobal = globalThis[RUNTIME_CONFIG_GLOBAL];

  if (fromWindow && typeof fromWindow === "object") return fromWindow;
  if (fromGlobal && typeof fromGlobal === "object") return fromGlobal;
  return {};
}

const runtimeConfig = readRuntimeConfig();

function readString(key, fallback) {
  const value = runtimeConfig[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readScopes() {
  const value = runtimeConfig.GRAPH_SCOPES;
  if (!Array.isArray(value)) return [...DEFAULT_GRAPH_SCOPES];
  const scopes = value.map((entry) => String(entry || "").trim()).filter(Boolean);
  return scopes.length ? scopes : [...DEFAULT_GRAPH_SCOPES];
}

function readZoomScopes() {
  const value = runtimeConfig.ZOOM_SCOPES;
  if (!Array.isArray(value)) return [...DEFAULT_ZOOM_SCOPES];
  const scopes = value.map((entry) => String(entry || "").trim()).filter(Boolean);
  return scopes.length ? scopes : [...DEFAULT_ZOOM_SCOPES];
}

export function isPlaceholderGraphValue(value) {
  const normalized = String(value || "").trim();
  return (
    !normalized
    || normalized === DEFAULT_GRAPH_CLIENT_ID
    || normalized === DEFAULT_GRAPH_TENANT_ID
    || normalized === "YOUR_TENANT_ID_HERE"
  );
}

export function isPlaceholderZoomValue(value) {
  const normalized = String(value || "").trim();
  return !normalized || normalized === DEFAULT_ZOOM_CLIENT_ID;
}

export const PRODUCT_NAME = readString("PRODUCT_NAME", DEFAULT_PRODUCT_NAME);
export const GRAPH_CLIENT_ID = readString("GRAPH_CLIENT_ID", DEFAULT_GRAPH_CLIENT_ID);
export const GRAPH_TENANT_ID = readString("GRAPH_TENANT_ID", DEFAULT_GRAPH_TENANT_ID);
export const GRAPH_SCOPES = readScopes();
export const ZOOM_CLIENT_ID = readString("ZOOM_CLIENT_ID", DEFAULT_ZOOM_CLIENT_ID);
export const ZOOM_API_BASE = readString("ZOOM_API_BASE", DEFAULT_ZOOM_API_BASE);
export const ZOOM_OAUTH_BASE = readString("ZOOM_OAUTH_BASE", DEFAULT_ZOOM_OAUTH_BASE);
export const ZOOM_SCOPES = readZoomScopes();
