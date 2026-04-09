export function pad(value) {
  return String(value).padStart(2, "0");
}

export function fmt12(timeValue) {
  if (!timeValue || !String(timeValue).includes(":")) return "";
  const [hours, minutes] = String(timeValue).split(":").map(Number);
  return `${hours % 12 || 12}:${pad(minutes)}${hours >= 12 ? " PM" : " AM"}`;
}

export function fmtDur(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function parseDate(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function fmtDateShort(dateString) {
  return parseDate(dateString).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function fmtDateLong(dateString) {
  return parseDate(dateString).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function toDateStr(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function mondayOf(date) {
  const day = new Date(date);
  const dayOfWeek = day.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  day.setDate(day.getDate() + diff);
  return day;
}

export function addMins(dateString, timeString, minutesToAdd) {
  const [hours, minutes] = String(timeString).split(":").map(Number);
  const date = parseDate(dateString);
  date.setHours(hours, minutes + minutesToAdd, 0, 0);
  return `${toDateStr(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

export function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const TIME_SLOTS = (() => {
  const values = [];
  for (let hours = 6; hours <= 20; hours += 1) {
    for (const minutes of [0, 30]) {
      values.push(`${pad(hours)}:${pad(minutes)}`);
    }
  }
  return values;
})();

export function getTimeOptionsHTML(selectedValue) {
  return [
    `<option value=""${selectedValue ? "" : " selected"}>Time needed</option>`,
    ...TIME_SLOTS.map(
    (value) =>
      `<option value="${value}"${value === selectedValue ? " selected" : ""}>${fmt12(value)}</option>`
    ),
  ].join("");
}

let toastTimer = null;

export function toast(message, duration = 2700, action = null) {
  const element = document.getElementById("toast");
  if (!element) return;
  if (action && action.label && action.callback) {
    element.innerHTML = `${esc(message)} <button class="toast-action">${esc(action.label)}</button>`;
    const button = element.querySelector(".toast-action");
    if (button) {
      button.onclick = (event) => {
        event.stopPropagation();
        element.classList.remove("show");
        clearTimeout(toastTimer);
        action.callback();
      };
    }
  } else {
    element.textContent = message;
  }
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove("show"), duration);
}

export function closeModal(id) {
  const element = document.getElementById(id);
  if (element) element.classList.remove("open");
}

export function downloadBlob(contents, filename, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function isMobile() {
  return window.innerWidth <= 768;
}

export function getLocalTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
