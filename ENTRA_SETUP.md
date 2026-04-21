# Entra Setup

This document lists the exact Microsoft Entra configuration required for this application to authenticate users and connect to Microsoft 365 / Microsoft Graph.

## Summary

This app needs a standard **Microsoft Entra app registration for a browser SPA**.

It does **not** need:

- a custom API under **Expose an API**
- a client secret
- custom application permissions for Microsoft Graph

It does need **delegated Microsoft Graph permissions** and the correct **SPA redirect URI(s)**.

## Create In Entra

### 1. App Registration

Create a new app registration with:

- **Platform / app type:** Single-page application (SPA)
- **Supported account types:** Accounts in this organizational directory only
- **Name:** e.g. `Fishbowl Training Planner`

## Authentication

### 2. Redirect URIs

Add the exact popup callback URL where the app completes Microsoft sign-in.

This application uses:

- `new URL("auth-callback.html", window.location.href)`

That means the redirect URI must point to `auth-callback.html` in the same hosted directory as the app.

Examples:

- `https://planner.company.com/auth-callback.html`
- `https://planner.company.com/training_planner/auth-callback.html`
- `http://localhost:5173/auth-callback.html` for local development

### 3. SPA Platform Settings

Configure the app registration as:

- **Platform:** SPA
- **Client secret:** Not required
- **Implicit grant:** Not required for this app
- **Public client flow:** Not required for this app

## API Permissions

Add these **Microsoft Graph delegated permissions**:

- `Calendars.ReadWrite`
- `Calendars.Read.Shared`

Then:

- **Grant admin consent** for the tenant

## Why These Permissions Are Required

### `Calendars.ReadWrite`

Used for:

- reading and writing the signed-in user's calendar
- creating and updating session events
- maintaining the sentinel/index event used by the app

### `Calendars.Read.Shared`

Used for:

- reading shared calendars
- PM access to IS calendar availability
- PM reconciliation reads against IS mailboxes when Exchange delegate/shared calendar read access exists

## Important: Exchange / Outlook Access Is Also Required

Entra approval alone is not enough for all app features.

The relevant Outlook / Exchange sharing must also exist:

- The **IS calendar must be shared** so the PM can read it

If that sharing is not configured:

- shared calendar availability checks will fail
- PM cross-mailbox reconciliation reads will fail

## Values To Configure In This App

After the Entra app registration is created, update the tracked runtime config:

- edit [js/config.js](js/config.js)
- `index.html` loads `js/config.js` before the app, so the committed file is the active runtime bootstrap
- use [js/config.example.js](js/config.example.js) as the clean placeholder/reference copy if you need to rebuild the file

Set:

- `GRAPH_CLIENT_ID` = **Application (client) ID**
- `GRAPH_TENANT_ID` = **Tenant ID GUID**

These values live inside the `window.__TRAINING_PLANNER_CONFIG__` object in `js/config.js`.

For production:

- use the real tenant ID GUID
- do **not** use `common`
- use the tenant-choice comments in `js/config.js` as the source of truth for `organizations` vs `common`

## Vendored MSAL Library

This app vendors the browser auth library locally instead of loading it from a CDN.

Current vendored version:

- `@azure/msal-browser` `2.39.0`
- file: [vendor/msal-browser-2.39.0.min.js](vendor/msal-browser-2.39.0.min.js)

Upgrade procedure:

1. Check the latest `2.x` version on the official npm package page for `@azure/msal-browser`.
2. Resolve the official tarball URL:
   `npm view @azure/msal-browser@<version> dist.tarball`
3. Download the tarball and extract `package/lib/msal-browser.min.js`.
4. Replace the vendored file in [vendor/](vendor/).
5. Update the filename reference in [index.html](index.html) if the version changed.
6. Run `npm test`.
7. Commit the vendored file and code change together.

## Recommended Production Setup

- **Supported account type:** Single-tenant
- **Tenant ID:** Your tenant GUID
- **Redirect URI:** Exact production app URL/path
- **Popup redirect URI:** Exact hosted `auth-callback.html` path
- **Graph delegated permissions:** `Calendars.ReadWrite`, `Calendars.Read.Shared`
- **Admin consent:** Granted

Optional:

- restrict access through enterprise app assignment if your tenant requires user/group assignment

## Verification Checklist

After setup, the app should be able to:

- sign in with popup
- read the signed-in user's calendar
- read shared IS calendar availability if sharing is configured
- create/update calendar events for the signed-in user
- reconcile handed-off IS state through delegated shared-calendar reads where mailbox sharing/delegate access exists
- stay in `handed_off_pending_is` when IS mailbox sharing/delegate access is missing, because PM reconciliation cannot read the foreign calendar/sentinel without that access

## Code References

The current codebase requires these settings based on:

- [js/config.js](js/config.js)
- [js/config.example.js](js/config.example.js)
- [js/m365.js](js/m365.js)
