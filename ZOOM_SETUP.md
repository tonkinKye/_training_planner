# Zoom Integration Setup

The training planner can auto-generate a Zoom meeting per session and surface the recording, transcript, and AI Companion summary inside the app. The feature is **dormant by default** — when `ZOOM_CLIENT_ID` is the placeholder, all Zoom code paths short-circuit and the UI hides Zoom-only actions. The bundle ships safe to deploy without a Zoom Marketplace approval.

This document covers the operational prerequisites a Zoom admin must complete before flipping the feature on.

## Hosting model

The PM signs in to Zoom **once** through the app. Meetings are then created on behalf of each Implementation Specialist (IS) using Zoom's **Schedule Privilege** ("Schedule For"). The PM's OAuth token never owns the meetings — the IS does.

For recordings, transcripts, and AI summaries, the PM is granted a **custom Zoom role** scoped to a user group containing only the ISs. The PM can read recording data for those ISs and **only** those ISs.

This mirrors the existing Microsoft 365 model where the PM is the actor and the IS is the represented mailbox.

## 1. Create the Zoom Marketplace OAuth app

1. Go to https://marketplace.zoom.us → **Develop → Build App** → **User-managed OAuth app** (do NOT pick Server-to-Server).
2. Disable account-wide install. Only the PM(s) will install it.
3. **Redirect URL for OAuth**: `<your-deployed-origin>/zoom-callback.html`
   - For GitHub Pages: `https://<your-username>.github.io/<repo-name>/zoom-callback.html`
   - For local dev: `http://localhost:8080/zoom-callback.html`
   - You can register multiple redirect URIs in the same Zoom app.
4. **OAuth allow list**: add the same origins.
5. **Scopes**: add the granular scopes listed below. The exact identifiers Zoom uses change over time — verify against the current Zoom scope catalogue. The defaults baked into `js/runtime-config.js` are:
   - `meeting:write:meeting` — create meetings
   - `meeting:update:meeting` — patch on reschedule
   - `meeting:delete:meeting` — delete on session removal / project close
   - `user:read:user` — lookups
   - `cloud_recording:read:list_user_recordings:admin` — list recordings across the scoped user group
   - `cloud_recording:read:recording:admin` — fetch transcript / recording file URLs
   - `meeting_summary:read:summary:admin` — fetch AI Companion summary
6. Do NOT enable any scope you don't need. The admin-level scopes are restricted to the IS user group by the role configuration in step 3 below.
7. Save and copy the **Client ID**. You do not need a Client Secret — the SPA uses PKCE.

## 2. Configure Schedule Privilege per IS

For each IS user in your Zoom account:

1. Zoom Web Portal → **Settings → Meeting → Schedule Privilege**
2. Click **Add** under "Assign scheduling privilege to"
3. Add the PM user's email.
4. Save.

This lets the PM create meetings hosted by that IS via `POST /users/{is_email}/meetings`. Without this step, Zoom returns a 400/403 and the planner falls back to a "TBA" location on the calendar event with a toast.

## 3. Scope recording access to the IS user group

Zoom's default Admin role grants the PM access to every user's recordings in the entire Zoom account, which is too broad. Restrict it:

1. Zoom Web Portal → **User Management → Groups** → **Add a Group**
   - Name: `Training-IS` (or similar)
   - Add every IS user to the group.
2. Zoom Web Portal → **User Management → Roles** → **Add a Role**
   - Name: `Training Planner Recordings`
   - Permissions: enable only **Cloud Recording → View**, **Meeting Summary → View** (and any closely-related read permissions current Zoom UI splits these into). Leave everything else off.
   - **Scope** the role to the `Training-IS` group, not the whole account.
3. Assign that role to the PM user.

If the exact role permissions aren't available (Zoom adjusts the catalogue over time), the documented fallback is **per-user Recording Privilege**: each IS, in their own Zoom settings, grants the PM access to view their recordings — analogous to Schedule Privilege but for the recording surface.

## 4. Enable Cloud Recording + Audio Transcript on each IS

Recordings are not generated for a meeting unless Cloud Recording is enabled on the host's account:

- Zoom Web Portal → **Settings → Recording → Cloud recording** → enabled
- Same screen → **Audio transcript** → enabled
- (Optional) **AI Companion → Meeting summary with AI Companion** → enabled if your Zoom plan includes it. When off, the planner silently hides the summary block; nothing else breaks.

## 5. Configure the planner

1. Open `js/config.js` (the tracked runtime config — see README.md).
2. Set `ZOOM_CLIENT_ID` to the value from step 1.
3. Adjust `ZOOM_SCOPES` only if you reduced/expanded scopes in step 1 (the defaults match `js/runtime-config.js`).
4. Reload the app. A **Connect Zoom** button appears in the header.

## 6. PM connects Zoom

Once per session storage / browser tab:

1. Click **Connect Zoom** in the header.
2. A popup opens to Zoom; sign in as the PM.
3. Approve the requested scopes.
4. The popup closes automatically; the header button changes to **Zoom: Connected**.

The access token is held in `sessionStorage` for the life of the tab and refreshed silently as long as the tab stays open. Close the tab and the token is dropped; sign in again next time. This matches MSAL's existing behaviour.

## 7. Using the integration

### Creating Zoom meetings

In the **New Project** wizard, step 4 (Location) now offers a select with two options:

- *Room name or Teams URL* (existing manual behaviour)
- *Generate Zoom meetings automatically*

Pick the Zoom option. When each session is pushed to Outlook (existing **Push** action), the planner first creates a Zoom meeting hosted by the appropriate calendar owner (PM for setup/hypercare phases, IS for implementation phases), then writes the Outlook event with the Zoom join URL as the Location and a "Join Zoom meeting" CTA in the body. Each session gets its own meeting.

### Rescheduling and deleting

- **Reschedule** a session → next push PATCHes the existing Zoom meeting in place.
- **Close project** → the planner DELETEs future Zoom meetings best-effort. If the delete fails, the local cleanup still proceeds and you'll see a toast.
- **Unschedule** a session today does **not** delete the Zoom meeting (mirrors the existing Graph behaviour). The meeting record remains for re-push later.

### Post-meeting (recording, transcript, AI summary)

Once a session date is in the past, the session card grows a **Post-meeting (Zoom)** expander. Click it, then **Refresh from Zoom** to pull the latest recording metadata. Zoom typically finishes cloud-recording processing within an hour of meeting end; refresh again if it's not ready.

Available actions:

- **Open recording** — the Zoom cloud recording play URL.
- **View transcript / Copy transcript / Download TXT / Download VTT** — the audio transcript, in plain text or raw WebVTT.
- **View Zoom AI summary** — the Zoom AI Companion summary, if your account has AI Companion enabled and a summary was generated.

Transcripts are cached in browser `localStorage` (per-session, 30-day TTL); only compact pointers (URLs, duration) are written back to the project sentinel.

### Feeding into Claude

The planner does **not** call any LLM directly. Use **Copy transcript** or **Download** and paste into [claude.ai](https://claude.ai/) (or wherever) for analysis. This avoids holding any LLM API key in a publicly-served JS bundle (the app is hosted on GitHub Pages; everything in the bundle is world-readable, regardless of the Microsoft login gate).

## Troubleshooting

| Symptom | Probable cause |
|---|---|
| "Zoom is not configured" toast | `ZOOM_CLIENT_ID` is still the placeholder in `js/config.js`. |
| Popup blocked when clicking Connect Zoom | Browser popup blocker; allow popups for the app origin. |
| Calendar event location is "TBA" with toast | The Zoom create call failed. Usual causes: PM not signed in to Zoom, Schedule Privilege not granted by the IS, network error. The Outlook event still pushes. |
| Refresh from Zoom returns nothing for a past meeting | Zoom is still processing the cloud recording (can take 30-90 min). Try again later. |
| "Zoom AI summary" button never appears | AI Companion isn't enabled on the host's licence or the per-meeting toggle. |
| 401/403 on recording fetch but Schedule-For works | Recording-access role/scope isn't right yet — see step 3 above. Per-user Recording Privilege is the documented fallback. |

## Reverting / dormant state

To turn the feature off without removing code:

- Replace `ZOOM_CLIENT_ID` in `js/config.js` with the placeholder `YOUR_ZOOM_CLIENT_ID_HERE` (or leave it empty).
- Reload the app. The Zoom option in step 4 becomes disabled with "(not configured)", existing projects auto-revert to manual location with a toast on load, and the Connect Zoom button hides.
- No data is purged.
