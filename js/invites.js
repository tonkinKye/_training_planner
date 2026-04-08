import { PRODUCT_NAME } from "./config.js";
import { getSessionBody } from "./session-templates.js";
import { getScheduleRow, getSession, saveState } from "./state.js";
import { fmt12, fmtDateLong, fmtDur, addMins, esc, toast } from "./utils.js";
import { refreshRow } from "./render.js";

export function parseInvitees() {
  const raw = document.getElementById("globalInvitees")?.value || "";
  return raw
    .split(/[,;\s\n]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

export function buildSubject(sessionName) {
  const client = document.getElementById("globalClient")?.value.trim() || "";
  return client ? `${PRODUCT_NAME} | ${client} | ${sessionName}` : `${PRODUCT_NAME} | ${sessionName}`;
}

function buildSignatureLines() {
  const organiser = document.getElementById("globalOrganiser")?.value.trim() || "";
  const organiserEmail = document.getElementById("globalEmail")?.value.trim() || "";
  const lines = [];
  if (organiser) lines.push(organiser);
  if (organiserEmail) lines.push(organiserEmail);
  return lines;
}

function buildSessionBodyText(sessionName) {
  const organiser = document.getElementById("globalOrganiser")?.value.trim() || "";
  return getSessionBody(sessionName).replace(
    /\{\{Consultant Name\}\}/g,
    organiser || "Your Consultant"
  );
}

export function buildBodyHTML(session, row) {
  const dateText = row.date ? fmtDateLong(row.date) : "To be confirmed";
  const timeText = row.time ? fmt12(row.time) : "To be confirmed";
  const location = document.getElementById("globalLocation")?.value.trim() || "";
  const organiser = document.getElementById("globalOrganiser")?.value.trim() || "";
  const organiserEmail = document.getElementById("globalEmail")?.value.trim() || "";
  const attendees = parseInvitees();
  const sessionText = buildSessionBodyText(session.name);
  const signatureLines = buildSignatureLines();
  const metaRows = [
    { label: "Date", value: dateText },
    { label: "Time", value: `${timeText} (${fmtDur(session.duration)})` },
    { label: "Location", value: location || "To be advised" },
  ];

  if (attendees.length) {
    metaRows.push({ label: "Attendees", value: attendees.join(", ") });
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Calibri,Arial,sans-serif;font-size:14px;color:#1a1f2e;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:#1a3a5c;padding:24px 28px;">
    <div style="color:#e6a817;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Training Session</div>
    <div style="color:#ffffff;font-size:22px;font-weight:700;line-height:1.2;">${esc(session.name)}</div>
  </td></tr>
  <tr><td style="background:#f8f9fb;border-bottom:1px solid #e5e7eb;padding:16px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
      ${metaRows
        .map(
          (rowItem) => `<tr>
        <td style="width:88px;padding:5px 0;color:#6b7280;font-weight:700;text-transform:uppercase;">${esc(
          rowItem.label
        )}</td>
        <td style="padding:5px 0;color:#1f2937;">${esc(rowItem.value)}</td>
      </tr>`
        )
        .join("")}
    </table>
  </td></tr>
  <tr><td style="padding:22px 28px;">
    <div style="font-size:14px;line-height:1.7;color:#374151;white-space:pre-line;">${esc(sessionText)}</div>
    ${
      organiser || organiserEmail
        ? `<div style="margin-top:18px;font-size:12px;color:#6b7280;">
        Trainer: <strong style="color:#374151;">${esc(organiser || "Your Consultant")}</strong>${
            organiserEmail ? ` &lt;${esc(organiserEmail)}&gt;` : ""
          }
      </div>`
        : ""
    }
    ${
      signatureLines.length
        ? `<div style="margin-top:18px;font-size:13px;color:#374151;white-space:pre-line;">${esc(
            `Thanks,\n${signatureLines.join("\n")}`
          )}</div>`
        : ""
    }
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function buildBodyPlain(session, row) {
  const dateText = row.date ? fmtDateLong(row.date) : "TBC";
  const timeText = row.time ? fmt12(row.time) : "TBC";
  const location = document.getElementById("globalLocation")?.value.trim() || "";
  const attendees = parseInvitees();
  const sessionText = buildSessionBodyText(session.name);
  const isUrl = Boolean(location && /^https?:\/\//i.test(location));
  const signatureLines = buildSignatureLines();
  const headerLines = [
    buildSubject(session.name),
    "=".repeat(Math.max(buildSubject(session.name).length, 48)),
    `Date:     ${dateText}`,
    `Time:     ${timeText} (${fmtDur(session.duration)})`,
    location && !isUrl ? `Location: ${location}` : null,
    attendees.length ? `To:       ${attendees.join(", ")}` : null,
    "-".repeat(48),
  ]
    .filter(Boolean)
    .join("\n");

  const joinBlock = isUrl ? `\n\n---\nJoin meeting\n${location}` : "";
  const signature = signatureLines.length ? `\n\nThanks,\n${signatureLines.join("\n")}` : "";

  return `${headerLines}\n\n${sessionText}${joinBlock}${signature}`;
}

export function outlookURL(session, row) {
  if (!row.date || !row.time) return null;
  const location = document.getElementById("globalLocation")?.value.trim() || "";
  const params = [
    `subject=${encodeURIComponent(buildSubject(session.name))}`,
    `startdt=${encodeURIComponent(`${row.date}T${row.time}:00`)}`,
    `enddt=${encodeURIComponent(addMins(row.date, row.time, session.duration))}`,
    "ismeeting=1",
  ];

  if (location) params.push(`location=${encodeURIComponent(location)}`);
  const attendees = parseInvitees();
  if (attendees.length) params.push(`to=${encodeURIComponent(attendees.join(";"))}`);

  return `https://outlook.office.com/calendar/action/compose?${params.join("&")}`;
}

export async function openOutlook(sessionId) {
  const row = getScheduleRow(sessionId);
  const session = getSession(sessionId);
  if (!row || !session || !row.date || !row.time) {
    toast("Set a date and time first");
    return;
  }

  const url = outlookURL(session, row);
  if (!url) return;

  const body = buildBodyPlain(session, row);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(body)
      .then(() => {
        toast("Invite text copied - paste it into the Outlook compose window", 4000);
      })
      .catch((error) => {
        console.warn("Clipboard write failed:", error);
        toast("Could not auto-copy invite text - paste it manually", 4000);
      });
  } else {
    toast("Clipboard not available - paste the invite text manually", 4000);
  }

  const openedWindow = window.open(url, "_blank", "noopener");
  if (!openedWindow) {
    toast("Popup blocked \u2014 invite text is on your clipboard. Open Outlook manually.", 5000);
    return;
  }

  row.outlookActioned = true;
  saveState();
  refreshRow(sessionId);
}
