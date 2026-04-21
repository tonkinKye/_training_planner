import test from "node:test";
import assert from "node:assert/strict";

import {
  __graphRequestForTests,
  __pushGraphEventForTests,
  __setMsalTestState,
  __writeSentinelExtensionForTests,
  applyDeepLinkProject,
  buildEventPayload,
  buildCloseNotificationBody,
  buildHandoffBody,
  closeProject,
  createHandoffEvent,
  fetchSentinel,
  normalizeCalendarEvents,
  pushOwnedSessions,
  pushSessionToCalendar,
  reconcileIsProjects,
  reconcilePmProjects,
  writeSentinel,
} from "../js/m365.js";
import { createSentinelPayload, parseSentinelProjects } from "../js/sentinel-model.js";
import { decodeProjectParam, encodeProjectParam } from "../js/deeplink.js";
import { getPhaseStages } from "../js/projects.js";
import { resetAppState, state } from "../js/state.js";

let nextId = 1;

function createHeaders(values = {}) {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [String(key).toLowerCase(), value])
  );
  return {
    get(name) {
      return map.get(String(name).toLowerCase()) || null;
    },
  };
}

function createGraphResponse(status, body = null, statusText = "OK", headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: createHeaders(headers),
    json: async () => body,
  };
}

function installWindowForGraph(t) {
  const previousWindow = globalThis.window;
  globalThis.window = globalThis;
  t.after(() => {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
    __setMsalTestState();
  });
}

function installMsalForGraphTests(t, instance) {
  installWindowForGraph(t);
  __setMsalTestState({
    instance,
    account: {
      username: "pm@example.com",
      name: "PM",
    },
  });
}

function makeSession(overrides = {}) {
  return {
    id: `m365-test-${nextId++}`,
    key: "test_session",
    name: "Test Session",
    durationMinutes: 90,
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

test("createHandoffEvent writes only a local PM notification event and updates local metadata", async () => {
  const project = makeProject();
  let graphCalls = 0;
  let persistCalls = 0;

  const handoff = await createHandoffEvent(project, {
    buildDeepLinkUrlImpl: () => ({
      url: "https://example.test/handoff",
      encoded: "payload",
      length: 24,
      warn: false,
    }),
    graphRequestImpl: async (path, options) => {
      graphCalls += 1;
      assert.equal(path, "https://graph.microsoft.com/v1.0/me/events");
      assert.equal(options.method, "POST");
      return { id: "handoff-event-1" };
    },
    persistActiveProjectsImpl: async () => {
      persistCalls += 1;
    },
  });

  assert.equal(graphCalls, 1);
  assert.equal(persistCalls, 1);
  assert.equal(handoff.url, "https://example.test/handoff");
  assert.equal(handoff.delegateUsed, false);
  assert.equal(project.handoff.eventId, "handoff-event-1");
  assert.equal(project.handoff.deepLinkUrl, "https://example.test/handoff");
  assert.equal(project.handoff.delegateUsed, false);
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

test("graphRequest surfaces popup auth failures instead of collapsing them to a generic token error", async (t) => {
  installMsalForGraphTests(t, {
    acquireTokenSilent: async () => {
      throw new Error("silent interaction required");
    },
    acquireTokenPopup: async () => {
      const error = new Error("Tenant policy blocked interactive token acquisition");
      error.errorCode = "token_policy_block";
      throw error;
    },
  });
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});

  await assert.rejects(
    () => __graphRequestForTests("https://graph.microsoft.com/v1.0/me"),
    (error) => {
      assert.equal(error.name, "GraphAuthError");
      assert.match(error.message, /Tenant policy blocked interactive token acquisition/);
      return true;
    }
  );
});

test("IS-owned event payloads stamp the project id extended property", () => {
  const project = makeProject();
  const session = makeSession({
    phase: "implementation",
    owner: "is",
    date: "2099-05-10",
    time: "11:00",
  });

  const payload = buildEventPayload(project, session);

  assert.equal(payload.singleValueExtendedProperties?.length, 1);
  assert.equal(payload.singleValueExtendedProperties?.[0]?.value, project.id);
});

test("PM-owned event payloads do not stamp the project id extended property", () => {
  const project = makeProject();
  const session = makeSession({
    phase: "setup",
    owner: "pm",
    date: "2099-04-10",
    time: "09:00",
  });

  const payload = buildEventPayload(project, session);

  assert.equal(payload.singleValueExtendedProperties, undefined);
});

test("pushGraphEvent falls back to POST when PATCH targets a missing event", async (t) => {
  installMsalForGraphTests(t, {
    acquireTokenSilent: async () => ({ accessToken: "token-1" }),
  });

  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, options = {}) => {
    calls.push({ path, method: options.method });
    if (calls.length === 1) {
      return createGraphResponse(404, {
        error: {
          message: "Event not found",
        },
      }, "Not Found");
    }
    return createGraphResponse(200, { id: "replacement-event" });
  });

  const session = makeSession({
    phase: "setup",
    owner: "pm",
    date: "2099-04-10",
    time: "09:00",
    graphEventId: "missing-event",
  });
  const project = makeProject({ setupSessions: [session] });

  const result = await __pushGraphEventForTests(session, project);

  assert.equal(result.id, "replacement-event");
  assert.equal(session.graphEventId, "");
  assert.deepEqual(
    calls.map((call) => ({ path: call.path, method: call.method })),
    [
      {
        path: "https://graph.microsoft.com/v1.0/me/events/missing-event",
        method: "PATCH",
      },
      {
        path: "https://graph.microsoft.com/v1.0/me/events",
        method: "POST",
      },
    ]
  );
});

test("writeSentinelExtension falls back to POST when the open extension is missing", async (t) => {
  installMsalForGraphTests(t, {
    acquireTokenSilent: async () => ({ accessToken: "token-2" }),
  });

  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, options = {}) => {
    calls.push({ path, method: options.method, body: options.body });
    if (calls.length === 1) {
      return createGraphResponse(404, {
        error: {
          message: "Extension missing",
        },
      }, "Not Found");
    }
    return createGraphResponse(200, { id: "extension-1" });
  });

  const result = await __writeSentinelExtensionForTests("series-master", []);

  assert.equal(result.id, "extension-1");
  assert.equal(calls[0].method, "PATCH");
  assert.match(calls[0].path, /\/events\/series-master\/extensions\/com\.fishbowl\.trainingplanner\.v1$/);
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].path, /\/events\/series-master\/extensions$/);
});

test("writeSentinel retries once with If-Match and preserves remote-only projects on conflict", async (t) => {
  installMsalForGraphTests(t, {
    acquireTokenSilent: async () => ({ accessToken: "token-3" }),
  });

  const localProject = makeProject();
  localProject.id = "local-project";
  const remoteProject = makeProject();
  remoteProject.id = "remote-project";
  state.graphAccount = {
    username: "pm@example.com",
    name: "PM",
  };

  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, options = {}) => {
    calls.push({ path, method: options.method, headers: options.headers, body: options.body });

    if (calls.length === 1) {
      return createGraphResponse(200, {
        value: [
          {
            id: "series-master",
            subject: "TP-ProjectIndex",
            type: "seriesMaster",
          },
        ],
      });
    }

    if (calls.length === 2) {
      return createGraphResponse(
        200,
        {
          id: "com.fishbowl.trainingplanner.v1",
          payload: JSON.stringify(createSentinelPayload([])),
        },
        "OK",
        { etag: "etag-1" }
      );
    }

    if (calls.length === 3) {
      assert.equal(options.headers["If-Match"], "etag-1");
      return createGraphResponse(412, {
        error: {
          message: "Precondition failed",
        },
      }, "Precondition Failed");
    }

    if (calls.length === 4) {
      return createGraphResponse(
        200,
        {
          id: "com.fishbowl.trainingplanner.v1",
          payload: JSON.stringify(createSentinelPayload([remoteProject])),
        },
        "OK",
        { etag: "etag-2" }
      );
    }

    const payload = JSON.parse(options.body);
    const parsed = JSON.parse(payload.payload);
    assert.equal(options.headers["If-Match"], "etag-2");
    assert.deepEqual(
      parsed.projects.map((project) => project.id),
      ["local-project", "remote-project"]
    );
    return createGraphResponse(200, { id: "extension-merged" });
  });

  const master = await writeSentinel([localProject]);

  assert.equal(master.id, "series-master");
});

test("applyDeepLinkProject seeds a new IS project from the link payload", async () => {
  resetAppState();
  const project = makeProject({
    implSessions: [
      makeSession({
        phase: "implementation",
        owner: "is",
        date: "2099-05-10",
        time: "11:00",
      }),
    ],
  });
  const payload = decodeProjectParam(encodeProjectParam(project).encoded);
  let persistCalls = 0;

  const applied = await applyDeepLinkProject(payload, {
    persistActiveProjectsImpl: async () => {
      persistCalls += 1;
    },
  });

  assert.equal(persistCalls, 1);
  assert.equal(state.projects.length, 1);
  assert.equal(applied.id, project.id);
  assert.equal(state.projects[0].id, project.id);
  assert.equal(getPhaseStages(state.projects[0], "implementation")[0].sessions[0].time, "11:00");
});

test("applyDeepLinkProject does not overwrite an existing IS project", async () => {
  resetAppState();
  const existingProject = makeProject({
    implSessions: [
      makeSession({
        phase: "implementation",
        owner: "is",
        date: "2099-05-12",
        time: "13:00",
        graphEventId: "evt-existing",
      }),
    ],
  });
  state.projects = [existingProject];
  state.activeProjectId = existingProject.id;

  const incomingProject = makeProject({
    implSessions: [
      makeSession({
        id: existingProject.phases.implementation.stages[0].sessions[0].id,
        phase: "implementation",
        owner: "is",
        date: "2099-05-15",
        time: "09:00",
        graphEventId: "evt-incoming",
      }),
    ],
  });
  incomingProject.id = existingProject.id;
  const payload = decodeProjectParam(encodeProjectParam(incomingProject).encoded);
  let persistCalls = 0;

  const applied = await applyDeepLinkProject(payload, {
    persistActiveProjectsImpl: async () => {
      persistCalls += 1;
    },
  });

  assert.equal(persistCalls, 0);
  assert.equal(applied, existingProject);
  assert.equal(state.projects.length, 1);
  assert.equal(getPhaseStages(state.projects[0], "implementation")[0].sessions[0].graphEventId, "evt-existing");
  assert.equal(getPhaseStages(state.projects[0], "implementation")[0].sessions[0].time, "13:00");
});

test("pushSessionToCalendar keeps Graph state and reports partial success when persistence fails", async (t) => {
  const session = makeSession({
    phase: "setup",
    owner: "pm",
    date: "2099-04-10",
    time: "09:00",
    graphEventId: "existing-event",
    graphActioned: false,
  });
  const project = makeProject({ setupSessions: [session] });
  t.mock.method(console, "error", () => {});
  const toasts = [];

  const result = await pushSessionToCalendar(session.id, {
    project,
    notify: true,
    pushGraphEventImpl: async () => ({ id: "new-event-id" }),
    persistActiveProjectsImpl: async () => {
      throw new Error("persist failed");
    },
    toastImpl: (message) => {
      toasts.push(message);
    },
  });

  assert.equal(result, true);
  assert.equal(session.graphEventId, "new-event-id");
  assert.equal(session.graphActioned, true);
  assert.match(toasts[0], /Calendar updated, but project index could not be saved/);
  assert.equal(state.sentinel.status, "error");
});

test("createHandoffEvent keeps local handoff metadata when persistence fails after event creation", async () => {
  resetAppState();
  const project = makeProject();

  await assert.rejects(
    () =>
      createHandoffEvent(project, {
        buildDeepLinkUrlImpl: () => ({
          url: "https://example.test/handoff",
          encoded: "payload",
          length: 24,
          warn: false,
        }),
        graphRequestImpl: async () => ({ id: "handoff-event-2" }),
        persistActiveProjectsImpl: async () => {
          throw new Error("persist failed");
        },
      }),
    (error) => {
      assert.equal(error.name, "GraphPartialCommitError");
      assert.match(error.message, /Handoff event created, but project index could not be saved/);
      return true;
    }
  );

  assert.equal(project.handoff.eventId, "handoff-event-2");
  assert.equal(project.handoff.deepLinkUrl, "https://example.test/handoff");
  assert.equal(state.ui.lastHandoff.eventId, "handoff-event-2");
  assert.equal(state.sentinel.status, "error");
});

test("closeProject keeps deletions and surfaces a partial commit if sentinel persistence fails", async (t) => {
  installMsalForGraphTests(t, {
    acquireTokenSilent: async () => ({ accessToken: "token-4" }),
  });

  state.graphAccount = {
    username: "pm@example.com",
    name: "PM",
  };

  const session = makeSession({
    phase: "setup",
    date: "2099-04-05",
    time: "09:00",
    graphEventId: "close-event-1",
    graphActioned: true,
  });
  const project = makeProject({ setupSessions: [session] });
  const calls = [];

  t.mock.method(globalThis, "fetch", async (path, options = {}) => {
    calls.push({ path, method: options.method, body: options.body });

    if (calls.length === 1) {
      assert.equal(options.method, "DELETE");
      return createGraphResponse(204, null, "No Content");
    }

    if (calls.length === 2) {
      return createGraphResponse(200, {
        value: [
          {
            id: "series-master",
            subject: "TP-ProjectIndex",
            type: "seriesMaster",
          },
        ],
      });
    }

    if (calls.length === 3) {
      return createGraphResponse(
        200,
        {
          id: "com.fishbowl.trainingplanner.v1",
          payload: JSON.stringify(createSentinelPayload([])),
        },
        "OK",
        { etag: "etag-close-1" }
      );
    }

    return createGraphResponse(500, {
      error: {
        message: "persist failed",
      },
    }, "Server Error");
  });

  await assert.rejects(
    () => closeProject(project),
    (error) => {
      assert.equal(error.name, "GraphPartialCommitError");
      assert.match(error.message, /Project closed and future calendar events removed, but project index could not be saved/);
      return true;
    }
  );

  assert.equal(session.graphEventId, "");
  assert.equal(session.graphActioned, false);
  assert.ok(project.closedAt);
  assert.equal(project.closedBy, "PM");
  assert.equal(state.sentinel.status, "error");
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

test("pushOwnedSessions persists once for an IS batch push without partner sentinel sync", async () => {
  const session = makeSession({
    phase: "implementation",
    owner: "is",
    date: "2099-05-10",
    time: "11:00",
  });
  const project = makeProject({ implSessions: [session] });
  let persistCalls = 0;

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
  });

  assert.equal(pushed, 1);
  assert.equal(persistCalls, 1);
  assert.equal(typeof project.isCommittedAt, "string");
});

test("read-only sentinel fetch does not seed a foreign mailbox sentinel when the extension is missing", async () => {
  let ensureCalls = 0;
  let readCalls = 0;
  let writeCalls = 0;
  const master = { id: "foreign-master" };

  const result = await fetchSentinel({
    userId: "is@example.com",
    createIfMissing: false,
    ensureSentinelSeriesImpl: async () => {
      ensureCalls += 1;
      return master;
    },
    findSentinelSeriesImpl: async () => master,
    readSentinelExtensionImpl: async () => {
      readCalls += 1;
      return null;
    },
    writeSentinelExtensionImpl: async () => {
      writeCalls += 1;
      return null;
    },
  });

  assert.equal(result.master, master);
  assert.deepEqual(result.projects, []);
  assert.equal(ensureCalls, 0);
  assert.equal(readCalls, 1);
  assert.equal(writeCalls, 0);
});

test("IS reconciliation marks moved implementation events as drift_detected and updates local session timing", async () => {
  const session = makeSession({
    phase: "implementation",
    owner: "is",
    date: "2099-05-10",
    time: "11:00",
    duration: 90,
    graphEventId: "evt-1",
    graphActioned: true,
    lastKnownStart: "2099-05-10T11:00:00",
    lastKnownEnd: "2099-05-10T12:30:00",
  });
  const project = makeProject({ implSessions: [session] });
  let persistCalls = 0;

  const result = await reconcileIsProjects({
    projects: [project],
    graphRequestImpl: async (path) => {
      assert.equal(path, "https://graph.microsoft.com/v1.0/$batch");
      return {
        responses: [
          {
            id: "0",
            status: 200,
            body: {
              id: "evt-1",
              start: { dateTime: "2099-05-10T13:00:00" },
              end: { dateTime: "2099-05-10T15:00:00" },
            },
          },
        ],
      };
    },
    persistProjectsImpl: async () => {
      persistCalls += 1;
    },
  });

  assert.equal(result.failed, false);
  assert.equal(result.reconciledCount, 1);
  assert.equal(result.driftedCount, 1);
  assert.equal(session.date, "2099-05-10");
  assert.equal(session.time, "13:00");
  assert.equal(session.durationMinutes, 120);
  assert.equal(session.lastKnownStart, "2099-05-10T13:00:00");
  assert.equal(session.lastKnownEnd, "2099-05-10T15:00:00");
  assert.equal(project.reconciliationState, "drift_detected");
  assert.equal(project.reconciliation.state, "drift_detected");
  assert.equal(persistCalls, 1);
});

test("one failed auth flow does not poison the next successful token request", async (t) => {
  installMsalForGraphTests(t, {
    acquireTokenSilent: async () => {
      throw new Error("silent interaction required");
    },
    acquireTokenPopup: async () => {
      const error = new Error("Tenant policy blocked interactive token acquisition");
      error.errorCode = "token_policy_block";
      throw error;
    },
  });
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});

  await assert.rejects(
    () => __graphRequestForTests("https://graph.microsoft.com/v1.0/me"),
    /Tenant policy blocked interactive token acquisition/
  );

  installMsalForGraphTests(t, {
    acquireTokenSilent: async () => ({ accessToken: "token-success" }),
  });
  t.mock.method(globalThis, "fetch", async () => createGraphResponse(200, { id: "ok" }));

  const response = await __graphRequestForTests("https://graph.microsoft.com/v1.0/me");
  assert.equal(response.id, "ok");
});

test("m365 test hooks throw in browser-like contexts", async (t) => {
  const previousWindow = globalThis.window;
  const previousProcess = globalThis.process;
  globalThis.window = {};
  Object.defineProperty(globalThis, "process", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  t.after(() => {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
    Object.defineProperty(globalThis, "process", {
      value: previousProcess,
      configurable: true,
      writable: true,
    });
  });

  assert.throws(() => __setMsalTestState(), /test-only hook unavailable in browser/);
  await assert.rejects(
    () => __graphRequestForTests("https://graph.microsoft.com/v1.0/me"),
    /test-only hook unavailable in browser/
  );
  await assert.rejects(
    () => __writeSentinelExtensionForTests("series-master", []),
    /test-only hook unavailable in browser/
  );
  await assert.rejects(
    () => __pushGraphEventForTests(makeSession({ date: "2099-04-10", time: "09:00" }), makeProject()),
    /test-only hook unavailable in browser/
  );
});

test("IS reconciliation marks deleted implementation events as drift_detected", async () => {
  const session = makeSession({
    phase: "implementation",
    owner: "is",
    date: "2099-05-10",
    time: "11:00",
    graphEventId: "evt-404",
    graphActioned: true,
    lastKnownStart: "2099-05-10T11:00:00",
    lastKnownEnd: "2099-05-10T12:30:00",
  });
  const project = makeProject({ implSessions: [session] });
  let persistCalls = 0;

  const result = await reconcileIsProjects({
    projects: [project],
    graphRequestImpl: async () => ({
      responses: [
        {
          id: "0",
          status: 404,
          body: {
            error: {
              message: "Not found",
            },
          },
        },
      ],
    }),
    persistProjectsImpl: async () => {
      persistCalls += 1;
    },
  });

  assert.equal(result.failed, false);
  assert.equal(result.driftedCount, 1);
  assert.equal(session.graphActioned, false);
  assert.equal(project.reconciliationState, "drift_detected");
  assert.equal(project.reconciliation.state, "drift_detected");
  assert.equal(persistCalls, 1);
});

test("PM reconciliation adopts IS state and round-trips sparse PM sentinel writes", async () => {
  const pmSession = makeSession({
    phase: "implementation",
    owner: "is",
    date: "2099-05-10",
    time: "11:00",
    graphEventId: "legacy-event",
    graphActioned: true,
    lastKnownStart: "2099-05-10T11:00:00",
    lastKnownEnd: "2099-05-10T12:30:00",
  });
  const pmProject = makeProject({ implSessions: [pmSession] });
  pmProject.handoff = { sentAt: "2099-05-01T00:00:00Z" };
  pmProject.reconciliation = {
    state: "refresh_failed",
    lastAttemptedAt: "2099-05-11T00:00:00Z",
    lastSuccessfulAt: "",
    lastFailureAt: "2099-05-11T00:00:00Z",
    lastFailureMessage: "old failure",
  };
  pmProject.reconciliationState = "refresh_failed";

  const isSession = makeSession({
    id: pmSession.id,
    phase: "implementation",
    owner: "is",
    date: "2099-05-12",
    time: "13:00",
    graphEventId: "evt-1",
    graphActioned: true,
    lastKnownStart: "2099-05-12T13:00:00",
    lastKnownEnd: "2099-05-12T14:30:00",
  });
  const isProject = makeProject({ implSessions: [isSession] });
  isProject.id = pmProject.id;
  isProject.handoff = { sentAt: "2099-05-01T00:00:00Z" };
  isProject.reconciliation = {
    state: "in_sync",
    lastAttemptedAt: "2099-05-12T00:00:00Z",
    lastSuccessfulAt: "2099-05-12T00:00:00Z",
    lastFailureAt: "",
    lastFailureMessage: "",
  };
  isProject.reconciliationState = "in_sync";

  const projects = [pmProject];
  let persistedPayload = null;

  const result = await reconcilePmProjects({
    projects,
    readSentinelImpl: async ({ userId }) => {
      assert.equal(userId, "is@example.com");
      return { projects: [isProject] };
    },
    persistProjectsImpl: async () => {
      persistedPayload = createSentinelPayload(projects, { mailbox: "pm@example.com" });
    },
  });

  assert.equal(result.reconciledCount, 1);
  assert.equal(result.pendingCount, 0);
  assert.equal(result.failedCount, 0);
  assert.equal(projects[0].lifecycleState, "is_active");
  assert.equal(projects[0].reconciliationState, "in_sync");
  assert.equal(projects[0].reconciliation.lastFailureMessage, "");
  assert.equal(projects[0].phases.implementation.stages[0].sessions[0].graphEventId, "evt-1");
  assert.equal(projects[0].phases.implementation.stages[0].sessions[0].time, "13:00");

  const roundTrip = parseSentinelProjects(persistedPayload);
  assert.equal(roundTrip[0].reconciliationState, "in_sync");
  assert.equal(roundTrip[0].phases.implementation.stages[0].sessions[0].id, pmSession.id);
  assert.equal(roundTrip[0].phases.implementation.stages[0].sessions[0].graphEventId, "");
  assert.equal(roundTrip[0].phases.implementation.stages[0].sessions[0].time, "");
});

test("PM reconciliation remains handed_off_pending_is when IS acceptance is not yet visible", async () => {
  const pmSession = makeSession({
    phase: "implementation",
    owner: "is",
    date: "2099-05-10",
    time: "11:00",
    graphEventId: "legacy-event",
    graphActioned: true,
  });
  const pmProject = makeProject({ implSessions: [pmSession] });
  pmProject.handoff = { sentAt: "2099-05-01T00:00:00Z" };
  pmProject.reconciliation = {
    state: "refresh_failed",
    lastAttemptedAt: "2099-05-11T00:00:00Z",
    lastSuccessfulAt: "",
    lastFailureAt: "2099-05-11T00:00:00Z",
    lastFailureMessage: "old failure",
  };
  pmProject.reconciliationState = "refresh_failed";

  const projects = [pmProject];

  const result = await reconcilePmProjects({
    projects,
    readSentinelImpl: async () => ({ projects: [] }),
    persistProjectsImpl: async () => {},
  });

  assert.equal(result.reconciledCount, 0);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(projects[0].lifecycleState, "handed_off_pending_is");
  assert.equal(projects[0].reconciliationState, "not_applicable");
  assert.equal(projects[0].reconciliation.lastFailureMessage, "");
  assert.equal(projects[0].phases.implementation.stages[0].sessions[0].graphEventId, "");
  assert.equal(projects[0].phases.implementation.stages[0].sessions[0].time, "");
});

test("PM reconciliation marks refresh_failed and clears stale implementation state when foreign read fails", async () => {
  const pmSession = makeSession({
    phase: "implementation",
    owner: "is",
    date: "2099-05-10",
    time: "11:00",
    graphEventId: "legacy-event",
    graphActioned: true,
  });
  const pmProject = makeProject({ implSessions: [pmSession] });
  pmProject.handoff = { sentAt: "2099-05-01T00:00:00Z" };

  const projects = [pmProject];

  const result = await reconcilePmProjects({
    projects,
    readSentinelImpl: async () => {
      throw new Error("read denied");
    },
    persistProjectsImpl: async () => {},
  });

  assert.equal(result.reconciledCount, 0);
  assert.equal(result.pendingCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(projects[0].reconciliationState, "refresh_failed");
  assert.equal(projects[0].reconciliation.lastFailureMessage, "read denied");
  assert.equal(projects[0].phases.implementation.stages[0].sessions[0].graphEventId, "");
  assert.equal(projects[0].phases.implementation.stages[0].sessions[0].time, "");
});
