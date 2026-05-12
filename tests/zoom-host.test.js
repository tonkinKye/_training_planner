import test from "node:test";
import assert from "node:assert/strict";

import { getZoomHostEmail, getZoomHostLabel } from "../js/zoom-host.js";

function project(overrides = {}) {
  return {
    pmEmail: "PM@Example.com",
    pmName: "Pat M.",
    isEmail: "IS@Example.com",
    isName: "Iz S.",
    phases: {
      setup: { calendarSource: "pm" },
      implementation: { calendarSource: "is" },
      hypercare: { calendarSource: "pm" },
    },
    ...overrides,
  };
}

test("implementation sessions resolve to the IS email", () => {
  assert.equal(getZoomHostEmail(project(), { phase: "implementation" }), "is@example.com");
  assert.equal(getZoomHostLabel(project(), { phase: "implementation" }), "Iz S.");
});

test("setup and hypercare sessions resolve to the PM email", () => {
  assert.equal(getZoomHostEmail(project(), { phase: "setup" }), "pm@example.com");
  assert.equal(getZoomHostEmail(project(), { phase: "hypercare" }), "pm@example.com");
});

test("shared calendar phases fall back to the PM email", () => {
  const sharedProject = project({
    phases: { weird: { calendarSource: "shared" } },
  });
  assert.equal(getZoomHostEmail(sharedProject, { phase: "weird" }), "pm@example.com");
});

test("missing email yields an empty string without throwing", () => {
  const blanks = project({ isEmail: "", isName: "" });
  assert.equal(getZoomHostEmail(blanks, { phase: "implementation" }), "");
  assert.equal(getZoomHostLabel(blanks, { phase: "implementation" }), "Implementation Specialist");
});

test("null inputs return safe defaults", () => {
  assert.equal(getZoomHostEmail(null, null), "");
  assert.equal(getZoomHostLabel(null, null), "");
});
