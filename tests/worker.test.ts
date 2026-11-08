import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore plain JS Worker
import worker from "../worker/index.js";

const files = new Set(["/index.html", "/about.html", "/favicon.png", "/legal/terms.html", "/app.js", "/live/index.html", "/live/live.js", "/live/sw.js", "/recruit/index.html", "/recruit/recruit.js"]);
const env = { ASSETS: { fetch: async (r: Request) => { let p = new URL(r.url).pathname; if (p.endsWith("/")) p += "index.html"; return files.has(p) ? new Response("FILE " + p) : new Response("404", { status: 404 }); } } };
const get = async (u: string) => { const r: Response = await worker.fetch(new Request(u), env); return r.status >= 300 && r.status < 400 ? "→ " + r.headers.get("location") : await r.text(); };

test("each address goes to its own site", async () => {
  assert.equal(await get("https://getfloorcall.com/"), "FILE /about.html");
  assert.equal(await get("https://app.getfloorcall.com/"), "FILE /index.html");
  assert.equal(await get("https://app.getfloorcall.com/app.js"), "FILE /app.js");
  assert.equal(await get("https://live.getfloorcall.com/"), "FILE /live/index.html");
  assert.equal(await get("https://live.getfloorcall.com/sw.js"), "FILE /live/sw.js");
  assert.equal(await get("https://recruit.getfloorcall.com/"), "FILE /recruit/index.html");
});
test("shared files and pages", async () => {
  assert.equal(await get("https://live.getfloorcall.com/favicon.png"), "FILE /favicon.png");
  assert.equal(await get("https://live.getfloorcall.com/legal/terms.html"), "→ https://getfloorcall.com/legal/terms.html");
  assert.equal(await get("https://app.getfloorcall.com/about.html"), "→ https://getfloorcall.com/about.html");
  assert.equal(await get("https://getfloorcall.com/legal/terms.html"), "FILE /legal/terms.html");
});
test("old links keep working", async () => {
  assert.equal(await get("https://getfloorcall.com/live/"), "→ https://live.getfloorcall.com/");
  assert.equal(await get("https://getfloorcall.com/recruit/?x=1"), "→ https://recruit.getfloorcall.com/?x=1");
  assert.equal(await get("https://www.getfloorcall.com/"), "→ https://getfloorcall.com/");
  assert.equal(await get("https://getfloorcall.com/index.html"), "→ https://app.getfloorcall.com/");
  assert.equal(await get("https://live.getfloorcall.com/live/"), "FILE /live/index.html");
});
test("test deployments keep paths side by side", async () => {
  assert.equal(await get("https://floorcall.me.workers.dev/"), "FILE /index.html");
  assert.equal(await get("https://floorcall.me.workers.dev/live/"), "FILE /live/index.html");
});
