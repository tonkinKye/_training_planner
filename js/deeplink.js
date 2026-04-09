import { getPhaseSessions } from "./projects.js";

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function getDeepLinkPayload(project) {
  const implementationSessions = getPhaseSessions(project, "implementation").map((session) => [
    session.key || "",
    session.bodyKey || "",
    session.name || "",
    Number(session.duration) || 90,
    session.type || "external",
    session.date || "",
    session.time || "",
  ]);

  return {
    v: 1,
    id: project.id,
    c: project.clientName || "",
    pt: project.projectType || "manufacturing",
    pm: project.pmEmail || "",
    pn: project.pmName || "",
    is: project.isEmail || "",
    in: project.isName || "",
    s: project.implementationStart || "",
    g: project.goLiveDate || "",
    h: project.hypercareDuration || "1 week",
    l: project.location || "",
    a: Array.isArray(project.invitees) ? project.invitees : [],
    st: project.status || "scheduling",
    impl: implementationSessions,
  };
}

export function encodeProjectParam(project) {
  const json = JSON.stringify(getDeepLinkPayload(project));
  const encoded = toBase64Url(new TextEncoder().encode(json));
  return {
    encoded,
    json,
    length: encoded.length,
  };
}

export function decodeHandoffPayload(value) {
  const bytes = fromBase64Url(value);
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (!payload || typeof payload !== "object" || !payload.id) {
    throw new Error("Invalid handoff payload.");
  }

  if (Array.isArray(payload.impl)) {
    payload.impl = payload.impl.map((session) =>
      Array.isArray(session)
        ? {
            k: session[0] || "",
            b: session[1] || "",
            n: session[2] || "",
            d: Number(session[3]) || 90,
            t: session[4] || "external",
            dt: session[5] || "",
            tm: session[6] || "",
          }
        : session
    );
  }

  return {
    ...payload,
    v: Number(payload.v) || 1,
    id: String(payload.id),
  };
}

export function decodeProjectParam(value) {
  return decodeHandoffPayload(value);
}

export function buildDeepLinkUrl(project) {
  const { encoded, length } = encodeProjectParam(project);
  const url = new URL(window.location.href);
  url.searchParams.set("project", encoded);
  return {
    url: url.toString(),
    encoded,
    length,
  };
}
