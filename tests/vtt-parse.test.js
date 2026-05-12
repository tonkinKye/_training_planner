import test from "node:test";
import assert from "node:assert/strict";

import { vttDurationSeconds, vttToPlainText } from "../js/vtt-parse.js";

const SAMPLE = `WEBVTT

1
00:00:00.000 --> 00:00:04.500
<v Pat M.>Welcome to the session. We will cover scope today.

2
00:00:04.500 --> 00:00:09.000
<v Iz S.>Sounds good. Let's review the implementation plan.

NOTE this is a note that should be ignored

3
00:00:09.000 --> 00:00:12.250
Thanks, this is great.`;

test("vttToPlainText strips timestamps, cue numbers, NOTE blocks, and angle tags", () => {
  const out = vttToPlainText(SAMPLE);
  assert.ok(out.includes("Pat M.: Welcome to the session."), "expected first cue to be present");
  assert.ok(out.includes("Iz S.: Sounds good."), "expected second cue with speaker label");
  assert.ok(!out.includes("00:00"), "timestamps should be removed");
  assert.ok(!out.includes("NOTE"), "NOTE block should be excluded");
  assert.ok(!out.includes("WEBVTT"), "header should be excluded");
});

test("vttToPlainText collapses cue line breaks within a single cue", () => {
  const wrapped = `WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nfirst line\ncontinuation line`;
  assert.equal(vttToPlainText(wrapped), "first line continuation line");
});

test("vttDurationSeconds returns the end timestamp of the final cue", () => {
  const duration = vttDurationSeconds(SAMPLE);
  assert.equal(duration, 12.25);
});

test("vttToPlainText returns empty string for non-VTT input", () => {
  assert.equal(vttToPlainText(""), "");
  assert.equal(vttToPlainText(null), "");
});

test("vttToPlainText respects includeSpeakers=false", () => {
  const out = vttToPlainText(SAMPLE, { includeSpeakers: false });
  assert.ok(!out.startsWith("Pat M."), "speaker label should be omitted");
  assert.ok(out.includes("Welcome to the session."));
});
