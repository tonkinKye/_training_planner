import { PRODUCT_NAME } from "./config.js";
import {
  getActorDisplayName,
  getCalendarOwnerName,
  getPhaseStages,
  PHASE_META,
  PHASE_ORDER,
  PROJECT_TYPE_META,
} from "./projects.js";
import { getSessionBody, GO_LIVE_SESSION_KEY } from "./session-templates.js";
import { esc, fmt12, fmtDateLong, fmtDur, toDateStr } from "./utils.js";

function getClientPlanSessions(project) {
  const sessions = [];
  for (const phaseKey of PHASE_ORDER) {
    const phaseLabel = PHASE_META[phaseKey]?.label || phaseKey;
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
          phaseLabel,
          stageLabel: stage.label || "",
          bodyText: rawBody.replace(/\{\{Consultant Name\}\}/g, ownerName || "Your Consultant"),
          isGoLive: session.key === GO_LIVE_SESSION_KEY,
        });
      }
    }
  }
  return sessions;
}

function buildProgressData(sessions) {
  return {
    total: sessions.length,
    scheduled: sessions.filter((s) => s.date && s.time).length,
    withDate: sessions.filter((s) => s.date).length,
  };
}

function buildSessionHTML(session) {
  const dateTime = session.date
    ? esc(fmtDateLong(session.date)) + (session.time ? `, ${esc(fmt12(session.time))}` : "") + ` (${esc(fmtDur(session.duration))})`
    : "To be confirmed";
  return `<article class="cp-session${session.isGoLive ? " cp-milestone" : ""}" data-session-date="${esc(session.date)}">
  <div class="cp-session-status"></div>
  <div class="cp-session-content">
    <div class="cp-session-header">
      <h4>${esc(session.name)}</h4>
      <span class="cp-session-datetime">${dateTime}</span>
    </div>
    <details class="cp-details">
      <summary>What to expect</summary>
      <p>${esc(session.bodyText)}</p>
    </details>
  </div>
</article>`;
}

function buildStageHTML(stageLabel, sessions) {
  return `<div class="cp-stage">
  <h3>${esc(stageLabel)}</h3>
  ${sessions.map(buildSessionHTML).join("\n  ")}
</div>`;
}

function buildPhaseHTML(project, phaseKey, sessions) {
  if (!sessions.length) return "";
  const phase = project.phases?.[phaseKey] || {};
  const ownerName = getCalendarOwnerName(project, phaseKey);
  const minW = Number.isFinite(phase.suggestedWeeksMin) ? phase.suggestedWeeksMin : null;
  const maxW = Number.isFinite(phase.suggestedWeeksMax) ? phase.suggestedWeeksMax : null;
  const weeksLabel = minW && maxW && minW !== maxW ? `${minW}-${maxW} weeks` : minW || maxW ? `${minW || maxW} week${(minW || maxW) === 1 ? "" : "s"}` : "";

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

  return `<section class="cp-phase cp-phase-${esc(phaseKey)}">
  <header class="cp-phase-header">
    <h2>${esc(PHASE_META[phaseKey]?.label || phaseKey)}</h2>
    <span class="cp-phase-meta">${esc(ownerName)}${weeksLabel ? ` &middot; ${esc(weeksLabel)}` : ""}</span>
  </header>
  ${stageGroups.map((g) => buildStageHTML(g.label, g.sessions)).join("\n  ")}
</section>`;
}

function buildSelfAgingScript() {
  return `<script>
(function() {
  document.addEventListener("DOMContentLoaded", function() {
    var d = new Date();
    var todayStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    var els = document.querySelectorAll("[data-session-date]");
    var completed = 0, todayCount = 0, upcoming = 0, tbc = 0, total = els.length, firstUpcoming = null;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var date = el.getAttribute("data-session-date");
      el.classList.remove("cp-completed", "cp-today", "cp-upcoming", "cp-tbc");
      if (!date) { el.classList.add("cp-tbc"); tbc++; }
      else if (date < todayStr) { el.classList.add("cp-completed"); completed++; }
      else if (date === todayStr) { el.classList.add("cp-today"); todayCount++; }
      else { el.classList.add("cp-upcoming"); upcoming++; if (!firstUpcoming) firstUpcoming = el; }
    }
    var done = completed + todayCount;
    var dated = total - tbc;
    var bar = document.getElementById("cp-progress-bar");
    var label = document.getElementById("cp-progress-label");
    if (bar) bar.style.width = (dated > 0 ? Math.round((done / dated) * 100) : 0) + "%";
    if (label) label.textContent = done === total && !tbc ? "All sessions completed" : done === 0 ? "Not yet started" : done + " of " + total + " sessions completed";
    if (firstUpcoming) {
      var m = document.createElement("div");
      m.className = "cp-here-marker";
      m.textContent = "\\u25B6 You are here";
      firstUpcoming.insertBefore(m, firstUpcoming.firstChild);
    }
    var pb = document.getElementById("cp-print-btn");
    if (pb) pb.addEventListener("click", function() {
      var ds = document.querySelectorAll("details.cp-details");
      for (var j = 0; j < ds.length; j++) ds[j].setAttribute("open", "");
      window.print();
    });
  });
})();
<\/script>`;
}

function buildEmbeddedCSS() {
  return `*{box-sizing:border-box;margin:0}
html{background:#f4efe7;color:#20303a;font:15px/1.55 'Trebuchet MS','Segoe UI',sans-serif}
.cp-container{max-width:720px;margin:0 auto;padding:2rem 1.25rem 3rem}
.cp-header{margin-bottom:2rem}
.cp-brand{display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem}
.cp-brand-mark{width:40px;height:40px;border-radius:12px;background:#163a59;color:#f4c95d;display:grid;place-items:center;font-weight:800;font-size:14px;flex-shrink:0}
.cp-eyebrow{font-size:0.72rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#66747d}
.cp-header h1{font-size:1.6rem;line-height:1.2;margin:0.15rem 0 0}
.cp-header-meta{margin:1rem 0}
.cp-header-meta dl{display:grid;grid-template-columns:1fr 1fr;gap:0.5rem}
.cp-header-meta dt{font-size:0.75rem;font-weight:700;text-transform:uppercase;color:#66747d}
.cp-header-meta dd{margin:0;font-size:0.92rem}
.cp-go-live-date{font-weight:700;color:#bf7a00}
.cp-progress{margin:1.25rem 0 1rem}
.cp-progress-text{font-size:0.88rem;margin-bottom:0.4rem;color:#66747d}
.cp-progress-track{height:8px;border-radius:99px;background:rgba(217,207,192,0.5);overflow:hidden}
.cp-progress-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,#f4c95d,#bf7a00);transition:width 0.4s}
.cp-print-btn{padding:0.5rem 1rem;border:1px solid #d9cfc0;border-radius:99px;background:#fffdf9;color:#20303a;font-size:0.82rem;cursor:pointer}
.cp-print-btn:hover{background:#f4efe7}
.cp-phase{margin-bottom:1.5rem}
.cp-phase-header{padding:0.65rem 0.85rem;border-radius:12px;margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem}
.cp-phase-header h2{font-size:1.1rem;margin:0}
.cp-phase-meta{font-size:0.8rem;color:#66747d}
.cp-phase-setup .cp-phase-header{background:rgba(46,111,149,0.1);border-left:4px solid #2e6f95}
.cp-phase-setup .cp-phase-header h2{color:#245774}
.cp-phase-implementation .cp-phase-header{background:rgba(187,122,18,0.1);border-left:4px solid #bb7a12}
.cp-phase-implementation .cp-phase-header h2{color:#8f5d0e}
.cp-phase-hypercare .cp-phase-header{background:rgba(77,143,100,0.1);border-left:4px solid #4d8f64}
.cp-phase-hypercare .cp-phase-header h2{color:#356348}
.cp-stage{margin-bottom:0.75rem}
.cp-stage h3{font-size:0.88rem;color:#66747d;margin:0 0 0.5rem;padding-left:0.25rem}
.cp-session{display:grid;grid-template-columns:6px 1fr;border:1px solid rgba(217,207,192,0.85);border-radius:12px;background:#fffdf9;overflow:hidden;margin-bottom:0.5rem;position:relative}
.cp-session-status{background:#d9cfc0;transition:background 0.3s}
.cp-session-content{padding:0.65rem 0.85rem}
.cp-session-header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:0.35rem}
.cp-session-header h4{font-size:0.95rem;margin:0}
.cp-session-datetime{font-size:0.82rem;color:#66747d;white-space:nowrap}
.cp-details{margin-top:0.4rem}
.cp-details summary{font-size:0.8rem;color:#66747d;cursor:pointer;padding:0.2rem 0}
.cp-details summary:hover{color:#20303a}
.cp-details p{font-size:0.85rem;line-height:1.6;color:#324152;padding:0.35rem 0 0;white-space:pre-line}
.cp-completed .cp-session-status{background:#22744d}
.cp-completed .cp-session-header h4::after{content:" \\2713";color:#22744d;font-weight:400}
.cp-completed{opacity:0.72}
.cp-today .cp-session-status{background:#f4c95d}
.cp-today{border-color:#bf7a00;box-shadow:0 0 0 1px rgba(191,122,0,0.2)}
.cp-today .cp-session-header h4::after{content:" \\2605";color:#bf7a00}
.cp-upcoming .cp-session-status{background:#2e6f95}
.cp-tbc .cp-session-status{background:transparent;border-right:2px dashed #d9cfc0}
.cp-tbc .cp-session-datetime{font-style:italic}
.cp-milestone{border-color:rgba(191,122,0,0.35);background:rgba(244,201,93,0.06)}
.cp-milestone .cp-session-header h4{color:#7a4f00}
.cp-here-marker{font-size:0.72rem;font-weight:700;color:#bf7a00;padding:0.15rem 0.5rem 0.3rem;letter-spacing:0.5px}
.cp-footer{margin-top:2rem;padding-top:1.25rem;border-top:1px solid #d9cfc0;font-size:0.82rem;color:#66747d}
.cp-legend{display:flex;flex-wrap:wrap;gap:0.75rem;margin-bottom:0.5rem}
.cp-legend-item{display:flex;align-items:center;gap:0.3rem}
.cp-legend-item::before{content:"";display:inline-block;width:10px;height:10px;border-radius:3px}
.cp-legend-completed::before{background:#22744d}
.cp-legend-today::before{background:#f4c95d}
.cp-legend-upcoming::before{background:#2e6f95}
.cp-legend-tbc::before{background:transparent;border:1.5px dashed #d9cfc0}
.cp-legend-milestone::before{background:linear-gradient(135deg,#f4c95d,#bf7a00)}
@media(max-width:540px){
  .cp-container{padding:1rem 0.75rem 2rem}
  .cp-header-meta dl{grid-template-columns:1fr}
  .cp-session-header{flex-direction:column}
}
@media print{
  html{background:#fff;font-size:12px}
  .cp-container{max-width:100%;padding:0}
  .cp-print-btn{display:none}
  .cp-details[open] summary{font-weight:700}
  .cp-session{break-inside:avoid;border-color:#ccc}
  .cp-phase{break-inside:avoid-page}
  .cp-here-marker{display:none}
  .cp-footer{position:running(footer)}
}`;
}

export function buildClientPlanHTML(project) {
  const sessions = getClientPlanSessions(project);
  const progress = buildProgressData(sessions);
  const generatedDate = toDateStr(new Date());
  const pmName = getActorDisplayName(project, "pm");
  const pmEmail = project.pmEmail || "";
  const clientName = project.clientName || "Training Plan";
  const projectTypeLabel = PROJECT_TYPE_META[project.projectType] || "Project";
  const goLiveDate = project.goLiveDate ? fmtDateLong(project.goLiveDate) : "To be confirmed";

  const phaseGroups = new Map();
  for (const phaseKey of PHASE_ORDER) {
    phaseGroups.set(phaseKey, sessions.filter((s) => s.phaseKey === phaseKey));
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
  <style>${buildEmbeddedCSS()}</style>
</head>
<body>
  <div class="cp-container">
    <header class="cp-header">
      <div class="cp-brand">
        <div class="cp-brand-mark">TP</div>
        <div>
          <div class="cp-eyebrow">${esc(PRODUCT_NAME)} ${esc(projectTypeLabel)} Implementation Plan</div>
          <h1>${esc(clientName)}</h1>
        </div>
      </div>
      <div class="cp-header-meta">
        <dl>
          <div><dt>Project Manager</dt><dd>${esc(pmName)}${pmEmail ? " &middot; " + esc(pmEmail) : ""}</dd></div>
          <div><dt>Go-Live</dt><dd class="cp-go-live-date">${esc(goLiveDate)}</dd></div>
        </dl>
      </div>
      <div class="cp-progress">
        <div class="cp-progress-text"><span id="cp-progress-label">${progress.scheduled} of ${progress.total} sessions scheduled</span></div>
        <div class="cp-progress-track"><div class="cp-progress-fill" id="cp-progress-bar" style="width:0%"></div></div>
      </div>
      <button id="cp-print-btn" class="cp-print-btn">Prepare for Print</button>
    </header>
    <main class="cp-main">
      ${phaseSections}
    </main>
    <footer class="cp-footer">
      <div class="cp-legend">
        <span class="cp-legend-item cp-legend-completed">Completed</span>
        <span class="cp-legend-item cp-legend-today">Today</span>
        <span class="cp-legend-item cp-legend-upcoming">Upcoming</span>
        <span class="cp-legend-item cp-legend-tbc">TBC</span>
        <span class="cp-legend-item cp-legend-milestone">Milestone</span>
      </div>
      <p>Generated on ${esc(fmtDateLong(generatedDate))} &middot; Contact ${esc(pmName)} for updates.</p>
    </footer>
  </div>
  ${buildSelfAgingScript()}
</body>
</html>`;
}
