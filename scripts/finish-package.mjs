// Turn a compiled package directory into one npm can publish.
//
//   node finish-package.mjs <source package dir> <output dir>
//
// Called by build-packages.sh after tsc has emitted <output>/dist. Four jobs:
//
// 1. Relative imports get their `.js`. TypeScript with bundler resolution
//    leaves `./provider` as written, which bundlers accept and Node's ES
//    module loader refuses. A published package has to work for both, so the
//    emitted specifiers are completed here, in the JavaScript and in the
//    declarations alike.
// 2. The SDK's entry gets "use client", so a Next.js server component can
//    import the provider. Only the entry needs it: it marks the boundary.
// 3. The manifest points at the build instead of the source.
// 4. README.md and LICENSE come along, and their absence is an error rather
//    than a package published without them.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const [sourceDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
if (!sourceDir || !outDir) {
  console.error("usage: finish-package.mjs <source package dir> <output dir>");
  process.exit(1);
}
const dist = join(outDir, "dist");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** `./provider` → `./provider.js`, `./generated` → `./generated/index.js`. */
function complete(fromFile, specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return specifier;
  if (/\.(m?js|json)$/.test(specifier)) return specifier;
  const base = resolve(dirname(fromFile), specifier);
  if (existsSync(`${base}.js`) || existsSync(`${base}.d.ts`)) return `${specifier}.js`;
  if (existsSync(join(base, "index.js")) || existsSync(join(base, "index.d.ts"))) {
    return `${specifier}/index.js`;
  }
  throw new Error(`${relative(outDir, fromFile)} imports ${specifier}, which the build did not emit`);
}

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\2/g;

for (const file of files(dist)) {
  if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
  const text = readFileSync(file, "utf8");
  const rewritten = text.replace(SPECIFIER, (_, lead, quote, specifier) => {
    return `${lead}${quote}${complete(file, specifier)}${quote}`;
  });
  if (rewritten !== text) writeFileSync(file, rewritten);
}

const manifest = JSON.parse(readFileSync(join(sourceDir, "package.json"), "utf8"));

if (manifest.name === "@mihe-dev/react") {
  const entry = join(dist, "index.js");
  const text = readFileSync(entry, "utf8");
  if (!text.startsWith('"use client"')) writeFileSync(entry, `"use client";\n${text}`);
}

const published = {
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  license: manifest.license,
  type: "module",
  main: "./dist/index.js",
  module: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js",
    },
    ...(manifest.name === "@mihe-dev/js" && {
      "./mihe.min.js": "./dist/mihe.min.js",
      "./mihe.iife.min.js": "./dist/mihe.iife.min.js",
    }),
    "./package.json": "./package.json",
  },
  ...(manifest.name === "@mihe-dev/js" && {
    // What jsDelivr and unpkg serve for the bare package URL: the classic
    // script, which works on any page. The ES module is beside it.
    jsdelivr: "./dist/mihe.iife.min.js",
    unpkg: "./dist/mihe.iife.min.js",
  }),
  files: ["dist", "README.md", "LICENSE"],
  sideEffects: false,
  homepage: "https://mihe.dev/docs",
  keywords: [
    "ai",
    "assistant",
    "copilot",
    "agent",
    ...(manifest.name === "@mihe-dev/react" ? ["react"] : []),
    ...(manifest.name === "@mihe-dev/js" ? ["vanilla", "javascript"] : []),
    "voice",
    "mihe",
  ],
  ...(manifest.peerDependencies && { peerDependencies: manifest.peerDependencies }),
  ...(manifest.dependencies && { dependencies: manifest.dependencies }),
  publishConfig: { access: "public" },
};
writeFileSync(join(outDir, "package.json"), `${JSON.stringify(published, null, 2)}\n`);

for (const name of ["README.md", "LICENSE"]) {
  const from = join(sourceDir, name);
  if (!existsSync(from)) throw new Error(`${relative(process.cwd(), from)} is missing; a package ships with it`);
  copyFileSync(from, join(outDir, name));
}
