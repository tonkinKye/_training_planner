import { ZOOM_API_BASE } from "./runtime-config.js";
import { acquireZoomToken, hasZoomConfig } from "./zoom-auth.js";

const ZOOM_TIMEOUT_MS = 30000;

let testRequestImpl = null;

export class ZoomAuthError extends Error {
  constructor(message, { status = 0, code = "" } = {}) {
    super(message);
    this.name = "ZoomAuthError";
    this.status = status;
    this.code = code;
  }
}

export class ZoomApiError extends Error {
  constructor(message, { status = 0, code = "", stage = "" } = {}) {
    super(message);
    this.name = "ZoomApiError";
    this.status = status;
    this.code = code;
    this.stage = stage;
  }
}

export { hasZoomConfig };

function buildUrl(path) {
  if (!path) return ZOOM_API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  const trimmed = path.startsWith("/") ? path : `/${path}`;
  return `${ZOOM_API_BASE}${trimmed}`;
}

async function zoomRequest(path, { method = "GET", body, token, headers = {}, stage = "" } = {}) {
  if (testRequestImpl) {
    return testRequestImpl({ path, method, body, token, headers, stage });
  }
  if (!hasZoomConfig()) {
    throw new ZoomAuthError("Zoom is not configured.", { code: "not_configured" });
  }
  const accessToken = token || (await acquireZoomToken({ interactive: false }));
  if (!accessToken) {
    throw new ZoomAuthError("Zoom is not connected. Click Connect Zoom and try again.", { code: "not_connected" });
  }
  const controller = new AbortController();
  const timeoutId = typeof window !== "undefined" && window.setTimeout
    ? window.setTimeout(() => controller.abort(), ZOOM_TIMEOUT_MS)
    : setTimeout(() => controller.abort(), ZOOM_TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(path), {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new ZoomAuthError(`Zoom authorisation failed (${response.status}).`, {
        status: response.status,
        code: "unauthorized",
      });
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new ZoomApiError(detail?.message || response.statusText || "Zoom request failed.", {
        status: response.status,
        code: detail?.code ? String(detail.code) : "",
        stage,
      });
    }
    if (response.status === 204) return null;
    return await response.json().catch(() => null);
  } finally {
    if (typeof window !== "undefined" && window.clearTimeout) {
      window.clearTimeout(timeoutId);
    } else {
      clearTimeout(timeoutId);
    }
  }
}

function toZoomDateTime(date, time) {
  if (!date || !time) return "";
  return `${date}T${time}:00`;
}

function buildMeetingPayload(sessionMeta = {}) {
  const payload = {
    topic: sessionMeta.topic || sessionMeta.name || "Training session",
    type: 2,
    duration: Number(sessionMeta.durationMinutes) || 60,
    timezone: sessionMeta.timezone || (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"),
    settings: {
      join_before_host: false,
      waiting_room: true,
      mute_upon_entry: true,
      auto_recording: sessionMeta.autoRecording || "none",
      approval_type: 2,
      audio: "both",
    },
  };
  if (sessionMeta.date && sessionMeta.time) {
    payload.start_time = toZoomDateTime(sessionMeta.date, sessionMeta.time);
  }
  if (sessionMeta.agenda) payload.agenda = String(sessionMeta.agenda).slice(0, 2000);
  return payload;
}

export async function createZoomMeeting(hostUserId, sessionMeta = {}) {
  if (!hostUserId) {
    throw new ZoomApiError("Zoom host email is required.", { stage: "create", code: "missing_host" });
  }
  const path = `/users/${encodeURIComponent(hostUserId)}/meetings`;
  const data = await zoomRequest(path, {
    method: "POST",
    body: buildMeetingPayload(sessionMeta),
    stage: "create",
  });
  return normaliseMeetingResponse(data);
}

export async function updateZoomMeeting(meetingId, sessionMeta = {}) {
  if (!meetingId) {
    throw new ZoomApiError("Zoom meeting ID is required.", { stage: "update", code: "missing_id" });
  }
  await zoomRequest(`/meetings/${encodeURIComponent(meetingId)}`, {
    method: "PATCH",
    body: buildMeetingPayload(sessionMeta),
    stage: "update",
  });
  return { id: String(meetingId) };
}

export async function deleteZoomMeeting(meetingId, { scheduleForReminder = false } = {}) {
  if (!meetingId) return false;
  const query = scheduleForReminder ? "?schedule_for_reminder=true" : "";
  await zoomRequest(`/meetings/${encodeURIComponent(meetingId)}${query}`, {
    method: "DELETE",
    stage: "delete",
  });
  return true;
}

export async function getMeetingRecordings(meetingId) {
  if (!meetingId) return null;
  const data = await zoomRequest(`/meetings/${encodeURIComponent(meetingId)}/recordings`, {
    method: "GET",
    stage: "recordings",
  });
  return normaliseRecordingsResponse(data);
}

export async function getMeetingSummary(meetingId) {
  if (!meetingId) return null;
  return await zoomRequest(`/meetings/${encodeURIComponent(meetingId)}/meeting_summary`, {
    method: "GET",
    stage: "summary",
  });
}

export async function downloadRecordingFile(url, { token, accept = "text/vtt,*/*" } = {}) {
  if (!url) return "";
  const accessToken = token || (await acquireZoomToken({ interactive: false }));
  if (!accessToken) {
    throw new ZoomAuthError("Zoom is not connected.", { code: "not_connected" });
  }
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: accept,
    },
  });
  if (!response.ok) {
    throw new ZoomApiError(`Recording download failed (${response.status}).`, {
      status: response.status,
      stage: "download",
    });
  }
  return await response.text();
}

function normaliseMeetingResponse(data = {}) {
  return {
    id: data.id ? String(data.id) : "",
    join_url: data.join_url || "",
    password: data.password || data.passcode || "",
    host_email: data.host_email || "",
    start_url: data.start_url || "",
    raw: data,
  };
}

function normaliseRecordingsResponse(data = {}) {
  const files = Array.isArray(data.recording_files) ? data.recording_files : [];
  const mp4 = files.find((file) => String(file.file_type || "").toUpperCase() === "MP4");
  const transcript = files.find((file) => {
    const type = String(file.file_type || "").toUpperCase();
    return type === "TRANSCRIPT" || type === "CC";
  });
  return {
    meetingId: data.id ? String(data.id) : "",
    uuid: data.uuid || "",
    topic: data.topic || "",
    startTime: data.start_time || "",
    durationMinutes: Number(data.duration) || 0,
    totalSize: Number(data.total_size) || 0,
    shareUrl: data.share_url || "",
    recordingPlayUrl: mp4?.play_url || mp4?.download_url || "",
    recordingDownloadUrl: mp4?.download_url || "",
    transcriptDownloadUrl: transcript?.download_url || "",
    files,
    raw: data,
  };
}

export function __injectZoomRequestImpl(impl) {
  testRequestImpl = typeof impl === "function" ? impl : null;
}
