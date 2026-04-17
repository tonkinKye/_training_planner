import test from "node:test";
import assert from "node:assert/strict";

import { updateRenderSlot } from "../js/render.js";

test("render slot updater skips rewriting unchanged markup", () => {
  const slot = {
    innerHTML: "",
    dataset: {},
    contains() {
      return false;
    },
  };

  assert.equal(updateRenderSlot(slot, "<section>first</section>"), true);
  assert.equal(slot.innerHTML, "<section>first</section>");
  assert.equal(slot.dataset.renderHtml, "<section>first</section>");

  assert.equal(updateRenderSlot(slot, "<section>first</section>"), false);
  assert.equal(slot.innerHTML, "<section>first</section>");

  assert.equal(updateRenderSlot(slot, "<section>second</section>"), true);
  assert.equal(slot.innerHTML, "<section>second</section>");
  assert.equal(slot.dataset.renderHtml, "<section>second</section>");
});
