import { PRODUCT_NAME } from "./runtime-config.js";
import { getActiveProject } from "./state.js";
import { findSession, getCalendarOwnerName, PHASE_META } from "./projects.js";
import { getSessionBody } from "./session-templates.js";
import { addMins, esc, fmt12, fmtDateLong, fmtDur, toast } from "./utils.js";

function getCurrentProjectSession(sessionId) {
  const project = getActiveProject();
  if (!project) return { project: null, session: null };
  const found = findSession(project, sessionId);
  return {
    project,
    session: found?.session || null,
  };
}

export function parseInvitees(value) {
  if (Array.isArray(value)) return value.filter(Boolean);

  return String(value || "")
    .split(/[,;\s\n]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

export function buildSubject(project, session) {
  const phaseLabel = PHASE_META[session.phase]?.label || "Session";
  if (project.clientName) {
    return `${PRODUCT_NAME} | ${project.clientName} | ${phaseLabel} | ${session.name}`;
  }
  return `${PRODUCT_NAME} | ${phaseLabel} | ${session.name}`;
}

function buildSignatureLines(project, session) {
  const ownerName = getCalendarOwnerName(project, session.phase);
  const ownerEmail = session.owner === "is" ? project.isEmail : project.pmEmail;
  const lines = [];
  if (ownerName) lines.push(ownerName);
  if (ownerEmail) lines.push(ownerEmail);
  return lines;
}

function buildSessionBodyText(project, session) {
  const ownerName = getCalendarOwnerName(project, session.phase);
  return getSessionBody(session.bodyKey || session.key, session.name).replace(
    /\{\{Consultant Name\}\}/g,
    ownerName || "Your Consultant"
  );
}

export function buildBodyHTML(project, session) {
  const dateText = session.date ? fmtDateLong(session.date) : "To be confirmed";
  const timeText = session.time ? fmt12(session.time) : "To be confirmed";
  const attendees = parseInvitees(project.invitees);
  const sessionText = buildSessionBodyText(project, session);
  const signatureLines = buildSignatureLines(project, session);
  const phaseLabel = PHASE_META[session.phase]?.label || "Session";
  const metaRows = [
    { label: "Phase", value: phaseLabel },
    { label: "Date", value: dateText },
    { label: "Time", value: `${timeText} (${fmtDur(session.duration)})` },
    { label: "Location", value: project.location || "To be advised" },
  ];

  if (attendees.length) {
    metaRows.push({ label: "Attendees", value: attendees.join(", ") });
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f5f1;font-family:'Trebuchet MS','Segoe UI',sans-serif;font-size:14px;color:#1f2933;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f1;padding:24px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 32px rgba(18,37,63,0.12);">
  <tr><td style="background:#163a59;padding:24px 28px;">
    <div style="color:#f4c95d;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">${esc(phaseLabel)} Phase</div>
    <div style="color:#ffffff;font-size:22px;font-weight:700;line-height:1.2;">${esc(session.name)}</div>
  </td></tr>
  <tr><td style="background:#f6f8fb;border-bottom:1px solid #d8e0ea;padding:16px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
      ${metaRows
        .map(
          (rowItem) => `<tr>
        <td style="width:96px;padding:5px 0;color:#637083;font-weight:700;text-transform:uppercase;">${esc(
          rowItem.label
        )}</td>
        <td style="padding:5px 0;color:#152536;">${esc(rowItem.value)}</td>
      </tr>`
        )
        .join("")}
    </table>
  </td></tr>
  <tr><td style="padding:22px 28px;">
    <div style="font-size:14px;line-height:1.7;color:#324152;white-space:pre-line;">${esc(sessionText)}</div>
    ${
      signatureLines.length
        ? `<div style="margin-top:18px;font-size:13px;color:#324152;white-space:pre-line;">${esc(
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

export function buildBodyPlain(project, session) {
  const dateText = session.date ? fmtDateLong(session.date) : "TBC";
  const timeText = session.time ? fmt12(session.time) : "TBC";
  const attendees = parseInvitees(project.invitees);
  const sessionText = buildSessionBodyText(project, session);
  const isUrl = Boolean(project.location && /^https?:\/\//i.test(project.location));
  const signatureLines = buildSignatureLines(project, session);
  const subject = buildSubject(project, session);
  const headerLines = [
    subject,
    "=".repeat(Math.max(subject.length, 48)),
    `Phase:    ${PHASE_META[session.phase]?.label || "Session"}`,
    `Date:     ${dateText}`,
    `Time:     ${timeText} (${fmtDur(session.duration)})`,
    project.location && !isUrl ? `Location: ${project.location}` : null,
    attendees.length ? `To:       ${attendees.join(", ")}` : null,
    "-".repeat(48),
  ]
    .filter(Boolean)
    .join("\n");

  const joinBlock = isUrl ? `\n\n---\nJoin meeting\n${project.location}` : "";
  const signature = signatureLines.length ? `\n\nThanks,\n${signatureLines.join("\n")}` : "";

  return `${headerLines}\n\n${sessionText}${joinBlock}${signature}`;
}

export function outlookURL(project, session) {
  if (!session.date || !session.time) return null;

  const params = [
    `subject=${encodeURIComponent(buildSubject(project, session))}`,
    `startdt=${encodeURIComponent(`${session.date}T${session.time}:00`)}`,
    `enddt=${encodeURIComponent(addMins(session.date, session.time, session.duration))}`,
    "ismeeting=1",
  ];

  if (project.location) params.push(`location=${encodeURIComponent(project.location)}`);
  const attendees = parseInvitees(project.invitees);
  if (attendees.length) params.push(`to=${encodeURIComponent(attendees.join(";"))}`);

  return `https://outlook.office.com/calendar/action/compose?${params.join("&")}`;
}

export async function openOutlook(sessionId) {
  const { project, session } = getCurrentProjectSession(sessionId);
  if (!project || !session || !session.date || !session.time) {
    toast("Set a date and time first");
    return false;
  }

  const url = outlookURL(project, session);
  if (!url) return false;

  const body = buildBodyPlain(project, session);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(body)
      .then(() => {
        toast("Invite text copied. Paste it into the Outlook compose window.", 4000);
      })
      .catch((error) => {
        console.warn("Clipboard write failed:", error);
        toast("Could not auto-copy invite text. Paste it manually.", 4000);
      });
  } else {
    toast("Clipboard unavailable. Paste the invite text manually.", 4000);
  }

  const openedWindow = window.open(url, "_blank", "noopener");
  if (!openedWindow) {
    toast("Popup blocked. Open Outlook manually and use the copied invite text.", 5000);
    return false;
  }

  session.outlookActioned = true;
  return true;
}
