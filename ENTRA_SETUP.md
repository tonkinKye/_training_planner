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

Add the exact URL(s) where the app is hosted.

This application uses:

- `window.location.origin + window.location.pathname`

That means the redirect URI must match the full runtime path, not just the domain.

Examples:

- `https://planner.company.com/`
- `https://planner.company.com/index.html`
- `http://localhost:5173/` for local development

### 3. SPA Platform Settings

Configure the app registration as:

- **Platform:** SPA
- **Client secret:** Not required
- **Implicit grant:** Not required for this app
- **Public client flow:** Not required for this app

## API Permissions

Add these **Microsoft Graph delegated permissions**:

- `Calendars.ReadWrite`
- `Calendars.ReadWrite.Shared`
- `People.Read`

Then:

- **Grant admin consent** for the tenant

## Why These Permissions Are Required

### `Calendars.ReadWrite`

Used for:

- reading and writing the signed-in user's calendar
- creating and updating session events
- maintaining the sentinel/index event used by the app

### `Calendars.ReadWrite.Shared`

Used for:

- reading shared calendars
- PM access to IS calendar availability
- delegate or shared-calendar write operations when supported by mailbox permissions

### `People.Read`

Used for:

- Microsoft 365 people search in onboarding/settings

## Important: Exchange / Outlook Access Is Also Required

Entra approval alone is not enough for all app features.

The relevant Outlook / Exchange sharing must also exist:

- The **IS calendar must be shared** so the PM can read it
- If the app is expected to write directly into the IS mailbox/calendar, the IS must grant appropriate **delegate/shared calendar write access**

If that sharing is not configured:

- shared calendar availability checks will fail
- delegate handoff/write flows may fail or fall back

## Values To Configure In This App

After the Entra app registration is created, update:

- [js/config.js](/c:/_apps/_training_planner/js/config.js:1)

Set:

- `GRAPH_CLIENT_ID` = **Application (client) ID**
- `GRAPH_TENANT_ID` = **Tenant ID GUID**

For production:

- use the real tenant ID GUID
- do **not** use `common`

## Recommended Production Setup

- **Supported account type:** Single-tenant
- **Tenant ID:** Your tenant GUID
- **Redirect URI:** Exact production app URL/path
- **Graph delegated permissions:** `Calendars.ReadWrite`, `Calendars.ReadWrite.Shared`, `People.Read`
- **Admin consent:** Granted

Optional:

- restrict access through enterprise app assignment if your tenant requires user/group assignment

## Verification Checklist

After setup, the app should be able to:

- sign in with popup
- search people
- read the signed-in user's calendar
- read shared IS calendar availability if sharing is configured
- create/update calendar events for the signed-in user
- perform delegate/shared calendar operations only where mailbox sharing/delegate access exists

## Code References

The current codebase requires these settings based on:

- [js/config.example.js](/c:/_apps/_training_planner/js/config.example.js:1)
- [js/config.js](/c:/_apps/_training_planner/js/config.js:1)
- [js/m365.js](/c:/_apps/_training_planner/js/m365.js:89)
- [js/m365.js](/c:/_apps/_training_planner/js/m365.js:143)
