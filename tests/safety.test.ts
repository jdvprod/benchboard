import { test } from "node:test";
import assert from "node:assert/strict";
import { safeUrl } from "../src/lib/safeUrl";
import { videoAt } from "../src/features/stats/FilmCard";

test("safety: links people type only ever become web links", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl(" JaVaScRiPt:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,<script>1</script>"), "");
  assert.equal(safeUrl("vbscript:x"), "");
  assert.equal(safeUrl("youtu.be/abc"), "https://youtu.be/abc");
  assert.equal(safeUrl("https://hudl.com/v/1"), "https://hudl.com/v/1");
  assert.equal(videoAt("javascript://youtu.be/%0aalert(1)", 30), "");
  assert.equal(videoAt("https://youtu.be/abc", 30), "https://youtu.be/abc?t=30s");
});
