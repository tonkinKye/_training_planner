window.__TRAINING_PLANNER_CONFIG__ = {
  PRODUCT_NAME: "Fishbowl",
  GRAPH_CLIENT_ID: "YOUR_CLIENT_ID_HERE",
  GRAPH_TENANT_ID: "YOUR_TENANT_ID_GUID_HERE", // production — pin to your Entra tenant
  // GRAPH_TENANT_ID: "common", // dev only — allows personal outlook.com accounts
  // Calendars.Read.Shared is required for delegated cross-mailbox calendar reads and will prompt re-consent on next login.
  GRAPH_SCOPES: ["Calendars.ReadWrite", "Calendars.Read.Shared"],
};
