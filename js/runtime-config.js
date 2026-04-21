export const RUNTIME_CONFIG_GLOBAL = "__TRAINING_PLANNER_CONFIG__";

const DEFAULT_PRODUCT_NAME = "Fishbowl";
const DEFAULT_GRAPH_CLIENT_ID = "YOUR_CLIENT_ID_HERE";
const DEFAULT_GRAPH_TENANT_ID = "YOUR_TENANT_ID_GUID_HERE";
const DEFAULT_GRAPH_SCOPES = ["Calendars.ReadWrite", "Calendars.Read.Shared"];

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

export function isPlaceholderGraphValue(value) {
  const normalized = String(value || "").trim();
  return (
    !normalized
    || normalized === DEFAULT_GRAPH_CLIENT_ID
    || normalized === DEFAULT_GRAPH_TENANT_ID
    || normalized === "YOUR_TENANT_ID_HERE"
  );
}

export const PRODUCT_NAME = readString("PRODUCT_NAME", DEFAULT_PRODUCT_NAME);
export const GRAPH_CLIENT_ID = readString("GRAPH_CLIENT_ID", DEFAULT_GRAPH_CLIENT_ID);
export const GRAPH_TENANT_ID = readString("GRAPH_TENANT_ID", DEFAULT_GRAPH_TENANT_ID);
export const GRAPH_SCOPES = readScopes();
