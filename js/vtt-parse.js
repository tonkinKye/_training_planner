const TIMESTAMP_LINE = /^\s*(\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3}/;
const SPEAKER_TAG = /<v(?:\.[^>]*)?\s+([^>]+?)>/i;
const ANGLE_TAGS = /<\/?[^>]+>/g;
const NOTE_OR_STYLE = /^(NOTE|STYLE|REGION)\b/i;

function stripCueTags(text) {
  return text.replace(ANGLE_TAGS, "").trim();
}

function extractSpeaker(line) {
  const match = line.match(SPEAKER_TAG);
  return match ? match[1].trim() : "";
}

export function vttToPlainText(vtt, { includeSpeakers = true } = {}) {
  if (!vtt || typeof vtt !== "string") return "";

  const lines = vtt.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let buffer = [];
  let currentSpeaker = "";
  let inCue = false;

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      blocks.push(currentSpeaker && includeSpeakers ? `${currentSpeaker}: ${text}` : text);
    }
    buffer = [];
    currentSpeaker = "";
    inCue = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line === "WEBVTT" || NOTE_OR_STYLE.test(line)) {
      flush();
      continue;
    }
    if (TIMESTAMP_LINE.test(line)) {
      flush();
      inCue = true;
      continue;
    }
    if (!inCue && /^\d+$/.test(line)) {
      continue;
    }
    if (!inCue) continue;

    const speaker = extractSpeaker(line);
    if (speaker && !currentSpeaker) currentSpeaker = speaker;
    buffer.push(stripCueTags(line));
  }
  flush();

  return blocks.join("\n");
}

export function vttDurationSeconds(vtt) {
  if (!vtt || typeof vtt !== "string") return 0;
  const matches = vtt.match(/(\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3}\s*-->\s*((\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})/g);
  if (!matches || !matches.length) return 0;
  const last = matches[matches.length - 1];
  const parts = last.split("-->")[1].trim().split(":");
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) {
    hours = Number(parts[0]) || 0;
    minutes = Number(parts[1]) || 0;
    seconds = Number(parts[2].replace(",", ".")) || 0;
  } else if (parts.length === 2) {
    minutes = Number(parts[0]) || 0;
    seconds = Number(parts[1].replace(",", ".")) || 0;
  }
  return hours * 3600 + minutes * 60 + seconds;
}
