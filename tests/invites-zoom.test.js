import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBodyHTML,
  buildBodyPlain,
  outlookURL,
  resolveSessionLocation,
} from "../js/invites.js";

function makeProject(overrides = {}) {
  return {
    clientName: "Acme",
    pmName: "Pat",
    pmEmail: "pm@example.com",
    isName: "Iz",
    isEmail: "is@example.com",
    location: "",
    locationMode: "manual",
    invitees: [],
    phases: {
      setup: { calendarSource: "pm" },
      implementation: { calendarSource: "is" },
      hypercare: { calendarSource: "pm" },
    },
    ...overrides,
  };
}

function makeSession(overrides = {}) {
  return {
    id: "s1",
    key: "kick_off_call",
    bodyKey: "kick_off_call",
    name: "Kick-off call",
    phase: "setup",
    durationMinutes: 60,
    date: "2026-05-20",
    time: "10:00",
    type: "external",
    owner: "pm",
    meetingProvider: "",
    meetingId: "",
    meetingUrl: "",
    meetingPasscode: "",
    ...overrides,
  };
}

test("resolveSessionLocation prefers session.meetingUrl in zoom-auto mode", () => {
  const project = makeProject({ locationMode: "zoom-auto", location: "Manual Room" });
  const session = makeSession({ meetingUrl: "https://zoom.us/j/abc" });
  assert.equal(resolveSessionLocation(project, session), "https://zoom.us/j/abc");
});

test("resolveSessionLocation falls back to project.location in manual mode", () => {
  const project = makeProject({ locationMode: "manual", location: "Room 4" });
  const session = makeSession({ meetingUrl: "https://zoom.us/j/abc" });
  assert.equal(resolveSessionLocation(project, session), "Room 4");
});

test("buildBodyHTML renders the Zoom join CTA and Location link when zoom-auto with meetingUrl", () => {
  const project = makeProject({ locationMode: "zoom-auto" });
  const session = makeSession({
    meetingProvider: "zoom",
    meetingUrl: "https://zoom.us/j/abc",
    meetingPasscode: "12345",
  });
  const html = buildBodyHTML(project, session);
  assert.match(html, /Join Zoom meeting/);
  assert.match(html, /https:\/\/zoom\.us\/j\/abc/);
  assert.match(html, /Passcode/);
  assert.match(html, /<a href="https:\/\/zoom\.us\/j\/abc"/);
});

test("buildBodyHTML does not show the Zoom CTA in manual mode", () => {
  const project = makeProject({ location: "Boardroom" });
  const session = makeSession();
  const html = buildBodyHTML(project, session);
  assert.doesNotMatch(html, /Join Zoom meeting/);
});

test("buildBodyHTML links a manual URL location even without Zoom", () => {
  const project = makeProject({ location: "https://example.com/meet" });
  const session = makeSession();
  const html = buildBodyHTML(project, session);
  assert.match(html, /<a href="https:\/\/example\.com\/meet"/);
});

test("buildBodyPlain includes the Zoom join block when present", () => {
  const project = makeProject({ locationMode: "zoom-auto" });
  const session = makeSession({
    meetingProvider: "zoom",
    meetingUrl: "https://zoom.us/j/abc",
    meetingPasscode: "secret",
  });
  const plain = buildBodyPlain(project, session);
  assert.match(plain, /Join Zoom meeting/);
  assert.match(plain, /https:\/\/zoom\.us\/j\/abc/);
  assert.match(plain, /Passcode: secret/);
});

test("buildBodyPlain falls back to the existing Join meeting block for non-zoom URL locations", () => {
  const project = makeProject({ location: "https://example.com/meet" });
  const session = makeSession();
  const plain = buildBodyPlain(project, session);
  assert.match(plain, /Join meeting/);
  assert.match(plain, /https:\/\/example\.com\/meet/);
});

test("outlookURL uses the resolved location (Zoom URL) for the Outlook compose location param", () => {
  const project = makeProject({ locationMode: "zoom-auto" });
  const session = makeSession({ meetingProvider: "zoom", meetingUrl: "https://zoom.us/j/xyz" });
  const url = outlookURL(project, session);
  assert.match(url, /location=https%3A%2F%2Fzoom\.us%2Fj%2Fxyz/);
});
