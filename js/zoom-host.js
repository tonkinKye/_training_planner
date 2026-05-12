import { getCalendarOwnerForPhase } from "./calendar-sources.js";

function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function getZoomHostEmail(project, session) {
  if (!project || !session) return "";
  const owner = getCalendarOwnerForPhase(session.phase, project);
  if (owner === "is") return normaliseEmail(project.isEmail);
  return normaliseEmail(project.pmEmail);
}

export function getZoomHostLabel(project, session) {
  if (!project || !session) return "";
  const owner = getCalendarOwnerForPhase(session.phase, project);
  if (owner === "is") return String(project.isName || project.isEmail || "Implementation Specialist").trim();
  return String(project.pmName || project.pmEmail || "Project Manager").trim();
}
