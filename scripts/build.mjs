// Builds the static site into ./docs (served by GitHub Pages).
//   node scripts/build.mjs            → docs/index.html + docs/assets/*
//   node scripts/build.mjs --single   → also dist/preview.html (everything inlined)
import { build } from "esbuild";
import { compile } from "tailwindcss";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const single = process.argv.includes("--single");

// 1. JavaScript — the live bundle never contains demo mode; the single-file preview does.
async function bundle(demo) {
  const out = await build({
    entryPoints: [join(root, "src/spa/main.tsx")],
    bundle: true,
    minify: true,
    format: "esm",
    target: ["es2020", "safari15"],
    jsx: "automatic",
    write: false,
    define: { "process.env.NODE_ENV": '"production"', __DEMO__: demo ? "true" : "false" },
    tsconfig: join(root, "tsconfig.json"),
    logLevel: "warning",
  });
  return out.outputFiles[0].text;
}
const jsCode = await bundle(false);

// 2. CSS — Tailwind v4 compiler fed with class candidates scanned from the source.
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|html)$/.test(f)) out.push(p);
  }
  return out;
}
const candidates = new Set();
for (const file of walk(join(root, "src"))) {
  for (const m of readFileSync(file, "utf8").matchAll(/[^\s"'`{}<>()]+/g)) candidates.add(m[0].replace(/[,;]$/, ""));
}
const twDir = dirname(require.resolve("tailwindcss/package.json"));
const compiler = await compile(readFileSync(join(root, "src/styles.css"), "utf8"), {
  base: join(root, "src"),
  loadStylesheet: async (id, base) => {
    if (id === "tailwindcss") return { path: join(twDir, "index.css"), base: twDir, content: readFileSync(join(twDir, "index.css"), "utf8") };
    const p = resolve(base, id);
    return { path: p, base: dirname(p), content: readFileSync(p, "utf8") };
  },
  loadModule: async () => {
    throw new Error("Plugins are not supported in this build");
  },
});
const css = compiler.build([...candidates]);

// 3. HTML
const hash = createHash("sha1").update(jsCode + css).digest("hex").slice(0, 10);
const head = (assets) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Leo Tennis Community</title>
<meta name="description" content="Private lessons, clinics and community tennis in San Diego. Book online, join waitlists and manage your schedule." />
<meta name="theme-color" content="#1F3A2E" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="Tennis" />
<link rel="manifest" href="manifest.webmanifest" />
<link rel="apple-touch-icon" href="apple-touch-icon.png" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231F3A2E'/%3E%3Ccircle cx='32' cy='32' r='15' fill='%23C9DC4B'/%3E%3C/svg%3E" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@500;600;700&display=swap" rel="stylesheet" />
${assets}
</head>
<body>
<div id="root"></div>
</body>
</html>
`;

const docs = join(root, "docs");
mkdirSync(join(docs, "assets"), { recursive: true });
writeFileSync(join(docs, "assets", `app.${hash}.js`), jsCode);
writeFileSync(join(docs, "assets", `app.${hash}.css`), css);
if (!existsSync(join(docs, "config.js"))) copyFileSync(join(root, "config.example.js"), join(docs, "config.js"));
// The config is inlined so a cached copy can never disagree with the page.
const liveConfig = readFileSync(join(docs, "config.js"), "utf8");
writeFileSync(
  join(docs, "index.html"),
  head(`<link rel="stylesheet" href="assets/app.${hash}.css" />
<script>${liveConfig}</script>
<script type="module" src="assets/app.${hash}.js"></script>`),
);
writeFileSync(join(docs, ".nojekyll"), "");
// Static files (app icons, manifest) are copied as-is.
const pub = join(root, "public");
if (existsSync(pub)) for (const f of readdirSync(pub)) copyFileSync(join(pub, f), join(docs, f));
console.log(`docs/ built · js ${(jsCode.length / 1024).toFixed(0)} kB · css ${(css.length / 1024).toFixed(0)} kB`);

if (single) {
  mkdirSync(join(root, "dist"), { recursive: true });
  const demoJs = await bundle(true);
  writeFileSync(
    join(root, "dist", "preview.html"),
    head(`<style>${css}</style>
<script>window.LTC_CONFIG = {};</script>
<script type="module">${demoJs.replace(/<\/script/gi, "<\\/script")}</script>`),
  );
  console.log("dist/preview.html built (demo data)");
}
