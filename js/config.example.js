window.__TRAINING_PLANNER_CONFIG__ = {
  PRODUCT_NAME: "Fishbowl",
  GRAPH_CLIENT_ID: "YOUR_CLIENT_ID_HERE",
  GRAPH_TENANT_ID: "YOUR_TENANT_ID_GUID_HERE", // production — pin to your Entra tenant
  // GRAPH_TENANT_ID: "common", // dev only — allows personal outlook.com accounts
  // Calendars.Read.Shared is required for delegated cross-mailbox calendar reads and will prompt re-consent on next login.
  GRAPH_SCOPES: ["Calendars.ReadWrite", "Calendars.Read.Shared"],

  // Leave ZOOM_CLIENT_ID empty/placeholder until the Zoom Marketplace OAuth app has been
  // approved and the IS user-group + custom role have been provisioned. See ZOOM_SETUP.md.
  // The feature stays dormant when this value is the placeholder.
  ZOOM_CLIENT_ID: "YOUR_ZOOM_CLIENT_ID_HERE",
  ZOOM_SCOPES: [
    "meeting:write:meeting",
    "meeting:update:meeting",
    "meeting:delete:meeting",
    "user:read:user",
    "cloud_recording:read:list_user_recordings:admin",
    "cloud_recording:read:recording:admin",
    "meeting_summary:read:summary:admin",
  ],
};
