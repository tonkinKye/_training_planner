import test from "node:test";
import assert from "node:assert/strict";

import {
  __injectZoomRequestImpl,
  createZoomMeeting,
  deleteZoomMeeting,
  getMeetingRecordings,
  getMeetingSummary,
  updateZoomMeeting,
  ZoomApiError,
} from "../js/zoom.js";

function captureCalls() {
  const calls = [];
  __injectZoomRequestImpl(async (args) => {
    calls.push(args);
    if (args.stage === "create") {
      return {
        id: 1234567890,
        join_url: "https://example.zoom.us/j/1234567890",
        password: "secret",
        host_email: args.path.includes("is%40example.com") ? "is@example.com" : "pm@example.com",
      };
    }
    if (args.stage === "recordings") {
      return {
        id: "1234567890",
        topic: "Test",
        start_time: "2026-05-12T10:00:00Z",
        duration: 60,
        recording_files: [
          { file_type: "MP4", play_url: "https://example.zoom.us/rec/play/abc", download_url: "https://example.zoom.us/rec/download/abc" },
          { file_type: "TRANSCRIPT", download_url: "https://example.zoom.us/rec/download/vtt" },
        ],
      };
    }
    if (args.stage === "summary") {
      return { summary_overview: "All good" };
    }
    return null;
  });
  return calls;
}

test.afterEach(() => __injectZoomRequestImpl(null));

test("createZoomMeeting POSTs to the host email's scheduling endpoint with the Schedule-For payload", async () => {
  const calls = captureCalls();
  const result = await createZoomMeeting("is@example.com", {
    topic: "Implementation kickoff",
    durationMinutes: 60,
    date: "2026-05-12",
    time: "10:00",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/users/is%40example.com/meetings");
  assert.equal(calls[0].body.topic, "Implementation kickoff");
  assert.equal(calls[0].body.type, 2);
  assert.equal(calls[0].body.duration, 60);
  assert.equal(calls[0].body.start_time, "2026-05-12T10:00:00");
  assert.equal(result.id, "1234567890");
  assert.equal(result.join_url, "https://example.zoom.us/j/1234567890");
  assert.equal(result.password, "secret");
});

test("updateZoomMeeting PATCHes the meeting endpoint", async () => {
  const calls = captureCalls();
  await updateZoomMeeting("1234567890", { topic: "Updated topic", durationMinutes: 45 });
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].path, "/meetings/1234567890");
  assert.equal(calls[0].body.duration, 45);
});

test("deleteZoomMeeting DELETEs the meeting endpoint", async () => {
  const calls = captureCalls();
  await deleteZoomMeeting("1234567890");
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].path, "/meetings/1234567890");
});

test("getMeetingRecordings extracts MP4 and transcript URLs", async () => {
  captureCalls();
  const result = await getMeetingRecordings("1234567890");
  assert.equal(result.meetingId, "1234567890");
  assert.equal(result.durationMinutes, 60);
  assert.equal(result.recordingPlayUrl, "https://example.zoom.us/rec/play/abc");
  assert.equal(result.transcriptDownloadUrl, "https://example.zoom.us/rec/download/vtt");
});

test("getMeetingSummary returns the response body", async () => {
  captureCalls();
  const result = await getMeetingSummary("1234567890");
  assert.equal(result.summary_overview, "All good");
});

test("createZoomMeeting refuses a missing host", async () => {
  __injectZoomRequestImpl(async () => { throw new Error("should not be called"); });
  await assert.rejects(() => createZoomMeeting("", { name: "test" }), (error) => {
    assert.ok(error instanceof ZoomApiError);
    assert.equal(error.code, "missing_host");
    return true;
  });
});

test("deleteZoomMeeting tolerates a missing meeting id (no-op)", async () => {
  __injectZoomRequestImpl(async () => { throw new Error("should not be called"); });
  const result = await deleteZoomMeeting("");
  assert.equal(result, false);
});
