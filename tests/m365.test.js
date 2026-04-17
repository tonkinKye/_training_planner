import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCloseNotificationBody,
  buildHandoffBody,
  normalizeCalendarEvents,
  pushOwnedSessions,
  pushSessionToCalendar,
} from "../js/m365.js";

let nextId = 1;

function makeSession(overrides = {}) {
  return {
    id: `m365-test-${nextId++}`,
    key: "test_session",
    name: "Test Session",
    duration: 90,
    phase: "setup",
    stageKey: "s1",
    owner: "pm",
    type: "external",
    order: 0,
    date: "",
    time: "",
    locked: false,
    lockedDate: false,
    lockedTime: false,
    graphEventId: "",
    graphActioned: false,
    outlookActioned: false,
    availabilityConflict: false,
    ...overrides,
  };
}

function makeProject({ setupSessions = [], implSessions = [], hcSessions = [] } = {}) {
  return {
    id: `project-${nextId++}`,
    clientName: "Client",
    pmName: "PM",
    pmEmail: "pm@example.com",
    isName: "IS",
    isEmail: "is@example.com",
    projectStart: "2099-04-01",
    implementationStart: "2099-05-01",
    goLiveDate: "2099-06-01",
    hypercareDuration: "1 week",
    handoff: {},
    phases: {
      setup: {
        owner: "pm",
        suggestedWeeksMin: null,
        suggestedWeeksMax: null,
        stages: [{ key: "setup_stage_1", label: "Setup", order: 0, rangeStart: "", rangeEnd: "", sessions: setupSessions }],
      },
      implementation: {
        owner: "is",
        suggestedWeeksMin: null,
        suggestedWeeksMax: null,
        stages: [{ key: "impl_stage_1", label: "Impl", order: 0, rangeStart: "", rangeEnd: "", sessions: implSessions }],
      },
      hypercare: {
        owner: "pm",
        suggestedWeeksMin: null,
        suggestedWeeksMax: null,
        stages: [{ key: "hc_stage_1", label: "HC", order: 0, rangeStart: "", rangeEnd: "", sessions: hcSessions }],
      },
    },
  };
}

test("calendar normalization keeps out-of-office events blocking availability", () => {
  const events = normalizeCalendarEvents(
    [
      {
        id: "busy-1",
        subject: "Working session",
        start: { dateTime: "2026-04-21T09:00:00" },
        end: { dateTime: "2026-04-21T10:00:00" },
        showAs: "busy",
        isCancelled: false,
      },
      {
        id: "oof-1",
        subject: "Annual leave",
        start: { dateTime: "2026-04-22T09:00:00" },
        end: { dateTime: "2026-04-22T17:00:00" },
        showAs: "oof",
        isCancelled: false,
      },
      {
        id: "free-1",
        subject: "Optional hold",
        start: { dateTime: "2026-04-23T09:00:00" },
        end: { dateTime: "2026-04-23T10:00:00" },
        showAs: "free",
        isCancelled: false,
      },
      {
        id: "cancelled-1",
        subject: "Cancelled booking",
        start: { dateTime: "2026-04-24T09:00:00" },
        end: { dateTime: "2026-04-24T10:00:00" },
        showAs: "busy",
        isCancelled: true,
      },
      {
        id: "sentinel-1",
        subject: "TP-ProjectIndex",
        start: { dateTime: "2026-04-25T09:00:00" },
        end: { dateTime: "2026-04-25T10:00:00" },
        showAs: "busy",
        isCancelled: false,
      },
    ],
    { owner: "pm" }
  );

  assert.deepEqual(
    events.map((event) => ({ id: event.id, subject: event.subject, showAs: event.showAs })),
    [
      { id: "pm:busy-1", subject: "Working session", showAs: "busy" },
      { id: "pm:oof-1", subject: "Annual leave", showAs: "oof" },
    ]
  );
});

test("handoff HTML escapes user-controlled project fields", () => {
  const html = buildHandoffBody(
    {
      clientName: `<img src=x onerror="alert('xss')">`,
      implementationStart: `2026-04-01"><script>bad()</script>`,
      goLiveDate: `2026-05-01`,
      isName: `<b>IS Owner</b>`,
      isEmail: "is@example.com",
      phases: {
        implementation: {
          stages: [
            {
              key: "impl",
              label: "Implementation",
              order: 0,
              sessions: [{ id: "s1", key: "test", name: "Session", duration: 90, phase: "implementation", stageKey: "impl", owner: "is", type: "external", order: 0, date: "", time: "" }],
            },
          ],
        },
      },
    },
    `https://example.com/?q="><script>bad()</script>`
  );

  assert.match(html, /&lt;img src=x onerror=&quot;alert\(&#39;xss&#39;\)&quot;&gt;/);
  assert.match(html, /2026-04-01&quot;&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;IS Owner&lt;\/b&gt;/);
  assert.match(html, /href="https:\/\/example\.com\/\?q=&quot;&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;"/);
  assert.doesNotMatch(html, /<img src=x onerror=/);
});

test("close notification HTML escapes user-controlled project fields", () => {
  const html = buildCloseNotificationBody(
    {
      clientName: `<script>alert("x")</script>`,
      closedBy: `<b>PM</b>`,
    },
    `1 May <img src=x onerror=alert(1)>`
  );

  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;PM&lt;\/b&gt;/);
  assert.match(html, /1 May &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("pushSessionToCalendar rolls back session state when persistence fails", async () => {
  const session = makeSession({
    phase: "setup",
    owner: "pm",
    date: "2099-04-10",
    time: "09:00",
    graphEventId: "existing-event",
    graphActioned: false,
  });
  const project = makeProject({ setupSessions: [session] });

  const result = await pushSessionToCalendar(session.id, {
    project,
    notify: false,
    pushGraphEventImpl: async () => ({ id: "new-event-id" }),
    persistActiveProjectsImpl: async () => {
      throw new Error("persist failed");
    },
  });

  assert.equal(result, false);
  assert.equal(session.graphEventId, "existing-event");
  assert.equal(session.graphActioned, false);
});

test("pushOwnedSessions persists once for a PM batch and suppresses per-session persistence", async () => {
  const session = makeSession({
    phase: "setup",
    owner: "pm",
    date: "2099-04-10",
    time: "09:00",
  });
  const project = makeProject({ setupSessions: [session] });
  const pushCalls = [];
  let persistCalls = 0;
  let fetchCalls = 0;

  const pushed = await pushOwnedSessions({
    actor: "pm",
    project,
    pushSessionToCalendarImpl: async (sessionId, options) => {
      pushCalls.push({ sessionId, options });
      session.graphActioned = true;
      return true;
    },
    persistActiveProjectsImpl: async () => {
      persistCalls += 1;
    },
    fetchCalendarEventsImpl: async () => {
      fetchCalls += 1;
      return [];
    },
  });

  assert.equal(pushed, 1);
  assert.equal(pushCalls.length, 1);
  assert.deepEqual(pushCalls[0].options, { project, persist: false, notify: false });
  assert.equal(persistCalls, 1);
  assert.equal(fetchCalls, 1);
});

test("pushOwnedSessions persists once and syncs partner sentinel for IS batch push", async () => {
  const session = makeSession({
    phase: "implementation",
    owner: "is",
    date: "2099-05-10",
    time: "11:00",
  });
  const project = makeProject({ implSessions: [session] });
  let persistCalls = 0;
  const syncCalls = [];

  const pushed = await pushOwnedSessions({
    actor: "is",
    project,
    pushSessionToCalendarImpl: async () => {
      session.graphActioned = true;
      return true;
    },
    persistActiveProjectsImpl: async () => {
      persistCalls += 1;
    },
    fetchCalendarEventsImpl: async () => [],
    syncProjectToPartnerSentinelImpl: async (nextProject, partnerRole) => {
      syncCalls.push({ project: nextProject, partnerRole });
      return true;
    },
  });

  assert.equal(pushed, 1);
  assert.equal(persistCalls, 1);
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0].project, project);
  assert.equal(syncCalls[0].partnerRole, "pm");
  assert.equal(typeof project.isCommittedAt, "string");
});
