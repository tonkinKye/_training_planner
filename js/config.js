window.__TRAINING_PLANNER_CONFIG__ = {
  PRODUCT_NAME: "Fishbowl",
  GRAPH_CLIENT_ID: "3248df34-1115-45f0-832f-32919ae81b91",
  // GRAPH_TENANT_ID: "organizations", // production — work/school only
  GRAPH_TENANT_ID: "common", // dev — allows personal outlook.com accounts
  // Calendars.Read.Shared is required for delegated cross-mailbox calendar reads and will prompt re-consent on next login.
  GRAPH_SCOPES: ["Calendars.ReadWrite", "Calendars.Read.Shared"],
};
