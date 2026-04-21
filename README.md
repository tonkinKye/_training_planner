# Training Planner

Browser-based project planning and calendar orchestration for Fishbowl training rollouts. The app schedules setup, implementation, and hypercare sessions, writes project state to a Microsoft 365 sentinel event, and supports PM/IS handoff and reconciliation workflows.

## Repo Layout

- `index.html`: SPA entrypoint
- `auth-callback.html`: dedicated Microsoft auth popup return page
- `js/`: application logic
- `css/`: stylesheets
- `tests/`: Node test suite
- `vendor/`: vendored third-party browser assets
- `ENTRA_SETUP.md`: Microsoft Entra / Graph setup requirements
- `AUDIT.md` / `AUDIT_PLAN.md`: audit findings and disposition

## Local Setup

1. Edit the tracked [js/config.js](js/config.js) runtime bootstrap.
2. Set `GRAPH_CLIENT_ID` and `GRAPH_TENANT_ID` inside the `window.__TRAINING_PLANNER_CONFIG__` object in `js/config.js`.
3. Register the app in Entra as a browser SPA and grant the delegated Graph permissions in `ENTRA_SETUP.md`.
4. Serve the repo root with any static web server and open the hosted URL in a browser.

Notes:

- `js/config.js` is the active tracked runtime config for this repo.
- The tracked file currently reflects a dev-style setup and keeps `GRAPH_TENANT_ID: "common"` by deliberate choice; replace it with your real tenant settings before any production deployment.
- `index.html` loads `js/config.js` before the app bootstrap, so config changes are deliberate source-controlled changes.
- [js/config.example.js](js/config.example.js) remains as a clean placeholder template/reference.
- The Microsoft popup flow returns to `auth-callback.html`, so that path must exist wherever the app is hosted.
- MSAL is vendored locally in `vendor/`; no CDN dependency is required at runtime.

## Tests

Run the full suite with:

```bash
npm test
```

## Supporting Docs

- [ENTRA_SETUP.md](ENTRA_SETUP.md): tenant/app-registration setup
- [vendor/README.md](vendor/README.md): vendored dependency upgrade procedure
- [AUDIT_PLAN.md](AUDIT_PLAN.md): current audit status and deferred decisions
