import { PRODUCT_NAME } from "./config.js";
import { getActorDisplayName, getCalendarOwnerName, getPhaseStages, getProjectTemplateLabel, PHASE_META, PHASE_ORDER } from "./projects.js";
import { getSessionBody } from "./session-templates.js";
import { esc, fmt12, fmtDateLong, fmtDur, toDateStr } from "./utils.js";

function getClientPlanSessions(project) {
  const sessions = [];
  for (const phaseKey of PHASE_ORDER) {
    const ownerName = getCalendarOwnerName(project, phaseKey);
    for (const stage of getPhaseStages(project, phaseKey)) {
      for (const session of stage.sessions) {
        if (session.type === "internal") continue;
        const rawBody = getSessionBody(session.bodyKey || session.key, session.name);
        sessions.push({
          name: session.name,
          date: session.date || "",
          time: session.time || "",
          duration: session.duration,
          phaseKey,
          stageLabel: stage.label || "",
          bodyText: rawBody.replace(/\{\{Consultant Name\}\}/g, ownerName || "Your Consultant"),
          isGoLive: Boolean(session.lockedDate),
        });
      }
    }
  }
  return sessions;
}

function buildProgressData(sessions) {
  return {
    total: sessions.length,
    scheduled: sessions.filter((session) => session.date && session.time).length,
    withDate: sessions.filter((session) => session.date).length,
  };
}

function buildSessionHTML(session) {
  const dateTime = session.date
    ? `${esc(fmtDateLong(session.date))}${session.time ? `, ${esc(fmt12(session.time))}` : ""} (${esc(fmtDur(session.duration))})`
    : "To be confirmed";

  return `<article class="tp-doc-session${session.isGoLive ? " tp-doc-session-milestone" : ""}" data-session-date="${esc(session.date)}">
  <div class="tp-doc-session-status"></div>
  <div class="tp-doc-session-content">
    <div class="tp-doc-session-header">
      <h4>${esc(session.name)}</h4>
      <span class="tp-doc-session-datetime">${dateTime}</span>
    </div>
    <details class="tp-doc-details">
      <summary>What to expect</summary>
      <p>${esc(session.bodyText)}</p>
    </details>
  </div>
</article>`;
}

function buildStageHTML(stageLabel, sessions) {
  return `<section class="tp-doc-stage">
  <h3>${esc(stageLabel || "Sessions")}</h3>
  <div class="tp-doc-stage-list">${sessions.map(buildSessionHTML).join("\n  ")}</div>
</section>`;
}

function buildPhaseHTML(project, phaseKey, sessions) {
  if (!sessions.length) return "";

  const phase = project.phases?.[phaseKey] || {};
  const ownerName = getCalendarOwnerName(project, phaseKey);
  const minWeeks = Number.isFinite(phase.suggestedWeeksMin) ? phase.suggestedWeeksMin : null;
  const maxWeeks = Number.isFinite(phase.suggestedWeeksMax) ? phase.suggestedWeeksMax : null;
  const weeksLabel = minWeeks && maxWeeks && minWeeks !== maxWeeks
    ? `${minWeeks}-${maxWeeks} weeks`
    : minWeeks || maxWeeks
      ? `${minWeeks || maxWeeks} week${(minWeeks || maxWeeks) === 1 ? "" : "s"}`
      : "";

  const stageGroups = [];
  let currentLabel = null;
  let currentSessions = [];
  for (const session of sessions) {
    if (session.stageLabel !== currentLabel) {
      if (currentSessions.length) stageGroups.push({ label: currentLabel, sessions: currentSessions });
      currentLabel = session.stageLabel;
      currentSessions = [];
    }
    currentSessions.push(session);
  }
  if (currentSessions.length) stageGroups.push({ label: currentLabel, sessions: currentSessions });

  return `<section class="tp-doc-phase tp-doc-phase-${esc(phaseKey)}">
  <header class="tp-doc-phase-header">
    <div>
      <div class="tp-doc-phase-label">${esc(PHASE_META[phaseKey]?.label || phaseKey)}</div>
      <h2>${esc(PHASE_META[phaseKey]?.label || phaseKey)} Phase</h2>
    </div>
    <span class="tp-doc-phase-meta">${esc(ownerName)}${weeksLabel ? ` &middot; ${esc(weeksLabel)}` : ""}</span>
  </header>
  ${stageGroups.map((group) => buildStageHTML(group.label, group.sessions)).join("\n  ")}
</section>`;
}

function buildSelfAgingScript() {
  return `<script>
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var today = new Date();
    var todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    var sessions = document.querySelectorAll("[data-session-date]");
    var completed = 0;
    var todayCount = 0;
    var tbc = 0;
    var firstUpcoming = null;

    for (var index = 0; index < sessions.length; index += 1) {
      var el = sessions[index];
      var date = el.getAttribute("data-session-date");
      el.classList.remove("tp-doc-completed", "tp-doc-today", "tp-doc-upcoming", "tp-doc-tbc");
      if (!date) {
        el.classList.add("tp-doc-tbc");
        tbc += 1;
      } else if (date < todayStr) {
        el.classList.add("tp-doc-completed");
        completed += 1;
      } else if (date === todayStr) {
        el.classList.add("tp-doc-today");
        todayCount += 1;
      } else {
        el.classList.add("tp-doc-upcoming");
        if (!firstUpcoming) firstUpcoming = el;
      }
    }

    var total = sessions.length;
    var done = completed + todayCount;
    var dated = total - tbc;
    var bar = document.getElementById("tp-doc-progress-bar");
    var label = document.getElementById("tp-doc-progress-label");
    if (bar) bar.style.width = (dated > 0 ? Math.round((done / dated) * 100) : 0) + "%";
    if (label) {
      label.textContent = done === total && !tbc
        ? "All sessions completed"
        : done === 0
          ? "Not yet started"
          : done + " of " + total + " sessions completed";
    }

    if (firstUpcoming && !document.querySelector(".tp-doc-here-marker")) {
      var marker = document.createElement("div");
      marker.className = "tp-doc-here-marker";
      marker.textContent = "\\u25B6 You are here";
      firstUpcoming.insertBefore(marker, firstUpcoming.firstChild);
    }

    var printButton = document.getElementById("tp-doc-print-btn");
    if (printButton) {
      printButton.addEventListener("click", function () {
        var details = document.querySelectorAll("details.tp-doc-details");
        for (var detailIndex = 0; detailIndex < details.length; detailIndex += 1) {
          details[detailIndex].setAttribute("open", "");
        }
        window.print();
      });
    }
  });
})();
<\/script>`;
}

function buildEmbeddedCSS() {
  return `/* Standalone document deviation: cp-* -> tp-doc-* namespace with an embedded token set for offline portability. */
:root{
  --font-base:'DM Sans',system-ui,sans-serif;
  --font-mono:'DM Mono',monospace;
  --nav:#18181A;
  --nav-mark-start:#2c6e5a;
  --nav-mark-end:#1c4a6e;
  --nav-mark-text:#FFFFFF;
  --page:#F4F2EE;
  --surface:#FFFFFF;
  --surface-subtle:#F9F8F6;
  --border:#E4E1D9;
  --border-md:#C8C4BA;
  --border-soft:#ECE8DF;
  --text:#1A1918;
  --muted:#6B6860;
  --hint:#A09C94;
  --amber-bg:#FAEEDA;
  --amber-text:#633806;
  --amber-btn:#D4890F;
  --teal-bg:#E1F5EE;
  --teal-text:#0F6E56;
  --teal-border:#9FE1CB;
  --blue-bg:#E6F1FB;
  --blue-text:#185FA5;
  --blue-mid:#378ADD;
  --blue-border:#B5D4F4;
  --green-bg:#EAF3DE;
  --green-text:#3B6D11;
  --green-mid:#639922;
  --green-border:#C0DD97;
  --purple-bg:#EEEDFE;
  --purple-text:#3C3489;
  --purple-border:#CECBF6;
  --gray-bg:#F1EFE8;
  --gray-text:#5F5E5A;
  --gray-border:#D3D1C7;
  --shadow-sm:0 1px 2px rgba(24,24,26,0.05);
  --shadow-md:0 12px 28px rgba(24,24,26,0.08);
}
*,
*::before,
*::after{box-sizing:border-box}
html{
  background:var(--page);
  color:var(--text);
  font-size:14px;
}
body{
  margin:0;
  background:var(--page);
  color:var(--text);
  font:14px/1.55 var(--font-base);
  -webkit-font-smoothing:antialiased;
}
button,
summary{font:inherit}
h1,h2,h3,h4,p,dl,dd{margin:0}
.tp-doc-shell{
  max-width:960px;
  margin:0 auto;
  padding:32px 20px 48px;
}
.tp-doc-header{
  display:grid;
  gap:18px;
  margin-bottom:22px;
  padding:24px;
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:18px;
  box-shadow:var(--shadow-md);
}
.tp-doc-brand{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
}
.tp-doc-brand-copy{
  display:flex;
  align-items:center;
  gap:14px;
}
.tp-doc-brand-mark{
  width:44px;
  height:44px;
  border-radius:12px;
  display:grid;
  place-items:center;
  background:linear-gradient(145deg,var(--nav-mark-start),var(--nav-mark-end));
  color:var(--nav-mark-text);
  font-size:14px;
  font-weight:700;
  letter-spacing:0.04em;
}
.tp-doc-eyebrow{
  color:var(--muted);
  font-size:10px;
  font-weight:700;
  letter-spacing:0.1em;
  text-transform:uppercase;
}
.tp-doc-header h1{
  margin-top:4px;
  font-size:32px;
  line-height:1.05;
  letter-spacing:-0.05em;
}
.tp-doc-meta{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
}
.tp-doc-meta-card{
  display:grid;
  gap:4px;
  padding:14px 16px;
  background:var(--surface-subtle);
  border:1px solid var(--border);
  border-radius:10px;
}
.tp-doc-meta-label{
  color:var(--hint);
  font-size:10px;
  font-weight:700;
  letter-spacing:0.08em;
  text-transform:uppercase;
}
.tp-doc-meta-value{
  font-size:14px;
  font-weight:600;
}
.tp-doc-go-live{
  color:var(--amber-text);
}
.tp-doc-header-actions{
  display:grid;
  gap:10px;
}
.tp-doc-progress{
  display:grid;
  gap:8px;
}
.tp-doc-progress-text{
  color:var(--muted);
  font-family:var(--font-mono);
  font-size:12px;
}
.tp-doc-progress-track{
  height:10px;
  border-radius:999px;
  background:var(--border-soft);
  overflow:hidden;
}
.tp-doc-progress-fill{
  height:100%;
  border-radius:inherit;
  background:linear-gradient(90deg,var(--amber-bg),var(--amber-btn));
  transition:width 0.35s ease;
}
.tp-doc-print-btn{
  justify-self:start;
  min-height:34px;
  padding:0 14px;
  border:1px solid var(--amber-btn);
  border-radius:6px;
  background:var(--amber-btn);
  color:var(--nav-mark-text);
  cursor:pointer;
  font-weight:700;
}
.tp-doc-main{
  display:grid;
  gap:18px;
}
.tp-doc-phase{
  display:grid;
  gap:12px;
}
.tp-doc-phase-header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:12px 14px;
  border:1px solid var(--border);
  border-radius:12px;
  background:var(--surface);
  box-shadow:var(--shadow-sm);
}
.tp-doc-phase-label{
  font-size:10px;
  font-weight:700;
  letter-spacing:0.08em;
  text-transform:uppercase;
}
.tp-doc-phase-header h2{
  margin-top:2px;
  font-size:20px;
  letter-spacing:-0.03em;
}
.tp-doc-phase-meta{
  color:var(--muted);
  font-size:12px;
  font-family:var(--font-mono);
  white-space:nowrap;
}
.tp-doc-phase-setup .tp-doc-phase-header{
  background:var(--teal-bg);
  border-color:var(--teal-border);
}
.tp-doc-phase-setup .tp-doc-phase-label,
.tp-doc-phase-setup .tp-doc-phase-header h2{
  color:var(--teal-text);
}
.tp-doc-phase-implementation .tp-doc-phase-header{
  background:var(--purple-bg);
  border-color:var(--purple-border);
}
.tp-doc-phase-implementation .tp-doc-phase-label,
.tp-doc-phase-implementation .tp-doc-phase-header h2{
  color:var(--purple-text);
}
.tp-doc-phase-hypercare .tp-doc-phase-header{
  background:var(--green-bg);
  border-color:var(--green-border);
}
.tp-doc-phase-hypercare .tp-doc-phase-label,
.tp-doc-phase-hypercare .tp-doc-phase-header h2{
  color:var(--green-text);
}
.tp-doc-stage{
  display:grid;
  gap:10px;
}
.tp-doc-stage h3{
  padding-left:2px;
  color:var(--muted);
  font-size:11px;
  font-weight:700;
  letter-spacing:0.08em;
  text-transform:uppercase;
}
.tp-doc-stage-list{
  display:grid;
  gap:8px;
}
.tp-doc-session{
  display:grid;
  grid-template-columns:6px 1fr;
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:10px;
  overflow:hidden;
  box-shadow:var(--shadow-sm);
  break-inside:avoid;
}
.tp-doc-session-status{
  background:var(--gray-border);
}
.tp-doc-session-content{
  padding:12px 14px;
}
.tp-doc-session-header{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
}
.tp-doc-session-header h4{
  font-size:15px;
  letter-spacing:-0.02em;
}
.tp-doc-session-datetime{
  color:var(--muted);
  font-family:var(--font-mono);
  font-size:12px;
  white-space:nowrap;
}
.tp-doc-details{
  margin-top:8px;
}
.tp-doc-details summary{
  color:var(--muted);
  font-size:12px;
  font-weight:600;
  cursor:pointer;
}
.tp-doc-details p{
  padding-top:8px;
  color:var(--text);
  white-space:pre-line;
}
.tp-doc-completed{
  opacity:0.72;
}
.tp-doc-completed .tp-doc-session-status{
  background:var(--green-mid);
}
.tp-doc-today{
  border-color:var(--amber-btn);
  box-shadow:0 0 0 2px var(--amber-bg);
}
.tp-doc-today .tp-doc-session-status{
  background:var(--amber-btn);
}
.tp-doc-upcoming .tp-doc-session-status{
  background:var(--blue-mid);
}
.tp-doc-tbc .tp-doc-session-status{
  background:transparent;
  border-right:2px dashed var(--gray-border);
}
.tp-doc-tbc .tp-doc-session-datetime{
  font-style:italic;
}
.tp-doc-session-milestone{
  border-color:var(--amber-btn);
  background:linear-gradient(0deg,var(--amber-bg),var(--amber-bg)),var(--surface);
}
.tp-doc-session-milestone .tp-doc-session-header h4{
  color:var(--amber-text);
}
.tp-doc-here-marker{
  margin-bottom:6px;
  color:var(--amber-text);
  font-size:10px;
  font-weight:700;
  letter-spacing:0.08em;
  text-transform:uppercase;
}
.tp-doc-footer{
  margin-top:24px;
  padding:16px 2px 0;
  border-top:1px solid var(--border);
  color:var(--muted);
  font-size:12px;
}
.tp-doc-legend{
  display:flex;
  align-items:center;
  gap:14px;
  margin-bottom:10px;
}
.tp-doc-legend-item{
  display:inline-flex;
  align-items:center;
  gap:6px;
}
.tp-doc-legend-item::before{
  content:"";
  width:10px;
  height:10px;
  border-radius:3px;
  background:var(--gray-border);
}
.tp-doc-legend-completed::before{background:var(--green-mid)}
.tp-doc-legend-today::before{background:var(--amber-btn)}
.tp-doc-legend-upcoming::before{background:var(--blue-mid)}
.tp-doc-legend-tbc::before{
  background:transparent;
  border:1px dashed var(--gray-border);
}
.tp-doc-legend-milestone::before{
  background:linear-gradient(135deg,var(--amber-bg),var(--amber-btn));
}
@media print{
  html{
    background:var(--surface);
    font-size:12px;
  }
  body{
    background:var(--surface);
  }
  .tp-doc-shell{
    max-width:100%;
    padding:0;
  }
  .tp-doc-header{
    box-shadow:none;
  }
  .tp-doc-print-btn{
    display:none;
  }
  .tp-doc-details[open] summary{
    font-weight:700;
  }
  .tp-doc-phase{
    break-inside:avoid-page;
  }
  .tp-doc-here-marker{
    display:none;
  }
}`;
}

export function buildClientPlanHTML(project) {
  const sessions = getClientPlanSessions(project);
  const progress = buildProgressData(sessions);
  const generatedDate = toDateStr(new Date());
  const pmName = getActorDisplayName(project, "pm");
  const pmEmail = project.pmEmail || "";
  const clientName = project.clientName || "Training Plan";
  const projectTypeLabel = getProjectTemplateLabel(project) || "Project";
  const goLiveDate = project.goLiveDate ? fmtDateLong(project.goLiveDate) : "To be confirmed";

  const phaseGroups = new Map();
  for (const phaseKey of PHASE_ORDER) {
    phaseGroups.set(phaseKey, sessions.filter((session) => session.phaseKey === phaseKey));
  }

  const phaseSections = PHASE_ORDER
    .filter((phaseKey) => phaseGroups.get(phaseKey).length > 0)
    .map((phaseKey) => buildPhaseHTML(project, phaseKey, phaseGroups.get(phaseKey)))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(clientName)} - ${esc(projectTypeLabel)} Training Plan</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${buildEmbeddedCSS()}</style>
</head>
<body>
  <div class="tp-doc-shell">
    <header class="tp-doc-header">
      <div class="tp-doc-brand">
        <div class="tp-doc-brand-copy">
          <div class="tp-doc-brand-mark">TP</div>
          <div>
            <div class="tp-doc-eyebrow">${esc(PRODUCT_NAME)} ${esc(projectTypeLabel)} Implementation Plan</div>
            <h1>${esc(clientName)}</h1>
          </div>
        </div>
      </div>
      <div class="tp-doc-meta">
        <div class="tp-doc-meta-card">
          <div class="tp-doc-meta-label">Project Manager</div>
          <div class="tp-doc-meta-value">${esc(pmName)}${pmEmail ? ` &middot; ${esc(pmEmail)}` : ""}</div>
        </div>
        <div class="tp-doc-meta-card">
          <div class="tp-doc-meta-label">Go-Live</div>
          <div class="tp-doc-meta-value tp-doc-go-live">${esc(goLiveDate)}</div>
        </div>
      </div>
      <div class="tp-doc-header-actions">
        <div class="tp-doc-progress">
          <div class="tp-doc-progress-text"><span id="tp-doc-progress-label">${progress.scheduled} of ${progress.total} sessions scheduled</span></div>
          <div class="tp-doc-progress-track"><div class="tp-doc-progress-fill" id="tp-doc-progress-bar" style="width:0%"></div></div>
        </div>
        <button id="tp-doc-print-btn" class="tp-doc-print-btn">Prepare for Print</button>
      </div>
    </header>
    <main class="tp-doc-main">
      ${phaseSections}
    </main>
    <footer class="tp-doc-footer">
      <div class="tp-doc-legend">
        <span class="tp-doc-legend-item tp-doc-legend-completed">Completed</span>
        <span class="tp-doc-legend-item tp-doc-legend-today">Today</span>
        <span class="tp-doc-legend-item tp-doc-legend-upcoming">Upcoming</span>
        <span class="tp-doc-legend-item tp-doc-legend-tbc">TBC</span>
        <span class="tp-doc-legend-item tp-doc-legend-milestone">Milestone</span>
      </div>
      <p>Generated on ${esc(fmtDateLong(generatedDate))} &middot; Contact ${esc(pmName)} for updates.</p>
    </footer>
  </div>
  ${buildSelfAgingScript()}
</body>
</html>`;
}
