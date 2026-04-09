import { getPhaseStages } from "./projects.js";
import { getTemplateDefinition } from "./session-templates.js";
import { DEEP_LINK_LIMIT } from "./state.js";

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

function getImplementationTemplateMaps(projectType) {
  const implementationStages = getTemplateDefinition(projectType)?.phases?.implementation?.stages || [];
  const stageMap = new Map();
  const sessionMap = new Map();

  implementationStages.forEach((stage) => {
    stageMap.set(stage.key, stage);
    (stage.sessions || []).forEach((session) => {
      sessionMap.set(session.key, {
        ...session,
        stageKey: stage.key,
        stageLabel: stage.label,
      });
    });
  });

  return { stageMap, sessionMap };
}

function encodeSessionTuple(session, templateSession) {
  const tuple = [session.id || "", session.key || "", session.date || "", session.time || ""];
  const needsExtendedTuple =
    !templateSession ||
    !session.key ||
    session.name !== templateSession.name ||
    Number(session.duration) !== Number(templateSession.duration) ||
    session.type !== templateSession.type ||
    (session.bodyKey || session.key || "") !== (templateSession.bodyKey || templateSession.key || "");

  if (needsExtendedTuple) {
    tuple.push(
      session.name || "",
      Number(session.duration) || 90,
      session.type || "external",
      session.bodyKey || session.key || ""
    );
  }

  return tuple;
}

function encodeImplementationStages(project) {
  const { stageMap, sessionMap } = getImplementationTemplateMaps(project.projectType || "manufacturing");
  // rangeStart/rangeEnd intentionally excluded — advisory only, recalculated by IS via Smart Fill
  return getPhaseStages(project, "implementation").map((stage) => [
    stage.key || "",
    stageMap.get(stage.key)?.label === stage.label ? "" : stage.label || "",
    (stage.sessions || []).map((session) => encodeSessionTuple(session, sessionMap.get(session.key))),
  ]);
}

function decodeSessionTuple(stageKey, stageLabel, tuple, templateSession, index) {
  if (!Array.isArray(tuple)) {
    return {
      ...tuple,
      phase: "implementation",
      owner: "is",
      stageKey,
      order: Number.isFinite(tuple?.order) ? Number(tuple.order) : index,
    };
  }

  const [id, key, date, time, name, duration, type, bodyKey] = tuple;
  return {
    id: id || "",
    key: key || "",
    bodyKey: bodyKey || templateSession?.bodyKey || key || "",
    name: name || templateSession?.name || key || stageLabel || "Implementation Session",
    duration: Number(duration) || templateSession?.duration || 90,
    type: type || templateSession?.type || "external",
    owner: "is",
    phase: "implementation",
    stageKey,
    order: index,
    date: date || "",
    time: time || "",
  };
}

function decodeImplementationStages(projectType, encodedStages) {
  const { stageMap, sessionMap } = getImplementationTemplateMaps(projectType || "manufacturing");
  return (Array.isArray(encodedStages) ? encodedStages : []).map((encodedStage, stageIndex) => {
    if (!Array.isArray(encodedStage)) {
      const stageKey = encodedStage?.key || `implementation_stage_${stageIndex + 1}`;
      return {
        key: stageKey,
        label: encodedStage?.label || stageMap.get(stageKey)?.label || `Stage ${stageIndex + 1}`,
        order: stageIndex,
        sessions: (encodedStage?.sessions || []).map((session, sessionIndex) =>
          decodeSessionTuple(stageKey, encodedStage?.label, session, sessionMap.get(session?.key), sessionIndex)
        ),
      };
    }

    const [stageKey, stageLabel, sessions] = encodedStage;
    const templateStage = stageMap.get(stageKey);
    return {
      key: stageKey || templateStage?.key || `implementation_stage_${stageIndex + 1}`,
      label: stageLabel || templateStage?.label || `Stage ${stageIndex + 1}`,
      order: stageIndex,
      sessions: (sessions || []).map((sessionTuple, sessionIndex) =>
        decodeSessionTuple(
          stageKey || templateStage?.key || `implementation_stage_${stageIndex + 1}`,
          stageLabel || templateStage?.label || `Stage ${stageIndex + 1}`,
          sessionTuple,
          Array.isArray(sessionTuple) ? sessionMap.get(sessionTuple[1]) : sessionMap.get(sessionTuple?.key),
          sessionIndex
        )
      ),
    };
  });
}

function decodeLegacyImplementationSessions(projectType, encodedSessions) {
  const { stageMap, sessionMap } = getImplementationTemplateMaps(projectType || "manufacturing");
  const stages = new Map();

  for (const templateStage of stageMap.values()) {
    stages.set(templateStage.key, {
      key: templateStage.key,
      label: templateStage.label,
      order: stages.size,
      sessions: [],
    });
  }

  (Array.isArray(encodedSessions) ? encodedSessions : []).forEach((sessionTuple, index) => {
    const templateSession = Array.isArray(sessionTuple) ? sessionMap.get(sessionTuple[1]) : sessionMap.get(sessionTuple?.k);
    const stageKey = templateSession?.stageKey || "implementation_manual";
    if (!stages.has(stageKey)) {
      stages.set(stageKey, {
        key: stageKey,
        label: stageKey === "implementation_manual" ? "Manual" : "Implementation",
        order: stages.size,
        sessions: [],
      });
    }
    stages
      .get(stageKey)
      .sessions.push(
        Array.isArray(sessionTuple)
          ? {
              id: "",
              key: sessionTuple[0] || "",
              bodyKey: sessionTuple[1] || sessionTuple[0] || "",
              name: sessionTuple[2] || templateSession?.name || "Implementation Session",
              duration: Number(sessionTuple[3]) || templateSession?.duration || 90,
              type: sessionTuple[4] || templateSession?.type || "external",
              owner: "is",
              phase: "implementation",
              stageKey,
              order: stages.get(stageKey).sessions.length,
              date: sessionTuple[5] || "",
              time: sessionTuple[6] || "",
            }
          : {
              id: sessionTuple.i || "",
              key: sessionTuple.k || "",
              bodyKey: sessionTuple.b || sessionTuple.k || "",
              name: sessionTuple.n || templateSession?.name || "Implementation Session",
              duration: Number(sessionTuple.d) || templateSession?.duration || 90,
              type: sessionTuple.t || templateSession?.type || "external",
              owner: "is",
              phase: "implementation",
              stageKey,
              order: stages.get(stageKey).sessions.length,
              date: sessionTuple.dt || "",
              time: sessionTuple.tm || "",
              graphEventId: sessionTuple.g || "",
            }
      );
  });

  return [...stages.values()].filter((stage) => stage.sessions.length);
}

export function getDeepLinkPayload(project) {
  return {
    v: 2,
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
    impl: encodeImplementationStages(project),
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
    const looksLikeStageArray =
      !payload.impl.length ||
      (Array.isArray(payload.impl[0]) && Array.isArray(payload.impl[0][2])) ||
      Array.isArray(payload.impl[0]?.sessions);
    payload.impl = looksLikeStageArray
      ? decodeImplementationStages(payload.pt || "manufacturing", payload.impl)
      : decodeLegacyImplementationSessions(payload.pt || "manufacturing", payload.impl);
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
  const warn = length > DEEP_LINK_LIMIT;
  if (warn) {
    console.warn(`[TP deeplink] Encoded payload is ${length} chars, exceeds limit of ${DEEP_LINK_LIMIT}`);
  }
  return {
    url: url.toString(),
    encoded,
    length,
    warn,
  };
}
