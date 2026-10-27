// Build script: bundles the app with esbuild into dist/.
//   node build.mjs          production build
//   node build.mjs --watch  rebuild on change and serve on http://localhost:5173
//   node build.mjs --test   run the unit tests
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const root = path.dirname(new URL(import.meta.url).pathname);
const args = new Set(process.argv.slice(2));
const nodePaths = (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean);
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;

if (args.has("--test")) {
  const out = path.join(root, ".test-build");
  rmSync(out, { recursive: true, force: true });
  const files = readdirSync(path.join(root, "tests")).filter((f) => f.endsWith(".test.ts"));
  await esbuild.build({ entryPoints: files.map((f) => path.join(root, "tests", f)), bundle: true, platform: "node", format: "esm", outdir: out, outExtension: { ".js": ".mjs" }, nodePaths, logLevel: "warning" });
  try { execFileSync(process.execPath, ["--test", ...readdirSync(out).map((f) => path.join(out, f))], { stdio: "inherit" }); }
  finally { rmSync(out, { recursive: true, force: true }); }
  process.exit(0);
}

const dist = path.join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(path.join(root, "public"), dist, { recursive: true });

const legal = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).legal || {};
const options = {
  entryPoints: { app: path.join(root, "src/main.tsx") },
  bundle: true, format: "esm", target: "es2020", outdir: dist, jsx: "automatic", splitting: true, chunkNames: "chunks/[name]-[hash]",
  minify: !args.has("--watch"), sourcemap: args.has("--watch") ? "inline" : false,
  define: { "process.env.NODE_ENV": args.has("--watch") ? '"development"' : '"production"', __APP_VERSION__: JSON.stringify(version), __LEGAL_VERSION__: JSON.stringify(String(legal.version || "1")), __LEGAL_EMAIL__: JSON.stringify(legal.email || "") },
  loader: { ".css": "css" }, nodePaths, logLevel: "info",
};

// Legal pages: owner, contact email, state and dates come from package.json "legal".
const legalTokens = {
  "%LEGAL_OWNER%": legal.owner || "the Benchboard team",
  "%LEGAL_EMAIL%": legal.email || "[add a contact email in package.json]",
  "%LEGAL_STATE%": legal.state || "California",
  "%LEGAL_EFFECTIVE%": legal.effective || "",
  "%LEGAL_VERSION%": legal.version || "1",
};
for (const f of readdirSync(path.join(dist, "legal"))) {
  if (!f.endsWith(".html")) continue;
  let t = readFileSync(path.join(dist, "legal", f), "utf8");
  for (const [k, v] of Object.entries(legalTokens)) t = t.replaceAll(k, v);
  writeFileSync(path.join(dist, "legal", f), t);
}

const html = readFileSync(path.join(root, "index.html"), "utf8").replaceAll("%VERSION%", version);
writeFileSync(path.join(dist, "index.html"), html);
const sw = readFileSync(path.join(root, "public/sw.js"), "utf8").replace("%VERSION%", version + "-" + Date.now().toString(36));
writeFileSync(path.join(dist, "sw.js"), sw);

if (args.has("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: dist, port: 5173 });
  console.log(`Benchboard running at http://localhost:${port}`);
} else {
  await esbuild.build(options);
  if (!existsSync(path.join(dist, "app.js"))) throw new Error("build failed");
  // precache lazily loaded chunks too, so exports work offline
  const chunkDir = path.join(dist, "chunks");
  const chunks = existsSync(chunkDir) ? readdirSync(chunkDir).map((f) => "./chunks/" + f) : [];
  const swPath = path.join(dist, "sw.js");
  writeFileSync(swPath, readFileSync(swPath, "utf8").replace('"./favicon.png"]', '"./favicon.png"' + chunks.map((c) => ", " + JSON.stringify(c)).join("") + "]"));
  // preload the chunks app.js needs at startup, so the browser fetches them in parallel instead of after app.js arrives
  const startup = new Set(), walk = (f) => { for (const m of readFileSync(path.join(dist, f), "utf8").matchAll(/(?:from|import)\s*"\.\/(?:chunks\/)?([^"]+\.js)"/g)) { const c = "chunks/" + m[1].replace(/^chunks\//, ""); if (!startup.has(c) && existsSync(path.join(dist, c))) { startup.add(c); walk(c); } } };
  walk("app.js");
  const idx = path.join(dist, "index.html");
  writeFileSync(idx, readFileSync(idx, "utf8").replace("</head>", [...startup].map((c) => `<link rel="modulepreload" href="${c}">`).join("") + "</head>"));
  console.log("Built to dist/");
}
