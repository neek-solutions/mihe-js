// Build @mihe-dev/js as single self-contained files, for pages with no build
// step: WordPress, a server-rendered site, a plain static/ folder.
//
//   node bundle-js.mjs <output dir>
//
// Called by build-packages.sh after the npm build of @mihe-dev/js, into that
// package's dist, so jsDelivr and unpkg serve them from the published
// package. Two files, each with a source map:
//
// - mihe.min.js       an ES module:  <script type="module">import { createMihe } from "…/mihe.min.js"
// - mihe.iife.min.js  a classic script that defines window.Mihe: Mihe.createMihe(…)
//
// esbuild is pinned to an exact version in sdk/package.json and runs only
// here, at build time. Nothing of it is in the output.

import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [outDir] = process.argv.slice(2).map((p) => resolve(p));
if (!outDir) {
  console.error("usage: bundle-js.mjs <output dir>");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(root, "js/package.json"), "utf8"));

const common = {
  entryPoints: [join(root, "js/src/index.ts")],
  bundle: true,
  minify: true,
  sourcemap: true,
  // Old enough for the browsers a WordPress site's visitors use, new enough
  // to keep optional chaining and classes as they are.
  target: "es2020",
  platform: "browser",
  // The protocol is bundled from source, so the file needs nothing beside it.
  alias: { "@mihe-dev/protocol": join(root, "protocol/src/index.ts") },
  banner: { js: `/*! ${manifest.name} ${manifest.version} | MIT © Neek Digital Solutions Ltd | https://mihe.dev */` },
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
};

const outputs = [
  { file: "mihe.min.js", format: "esm" },
  { file: "mihe.iife.min.js", format: "iife", globalName: "Mihe" },
];

for (const { file, ...format } of outputs) {
  const outfile = join(outDir, file);
  const result = await build({ ...common, ...format, outfile });

  // Self-contained or it is no use on a page without a bundler: one bare
  // import left in, and the browser refuses the whole file.
  for (const [name, output] of Object.entries(result.metafile.outputs)) {
    const external = output.imports.filter((entry) => entry.external);
    if (external.length > 0) {
      throw new Error(`${name} still imports ${external.map((e) => e.path).join(", ")}`);
    }
  }

  const size = statSync(outfile).size;
  const gzipped = gzipSync(readFileSync(outfile)).length;
  console.log(`  ${file}  ${(size / 1024).toFixed(1)} kB, ${(gzipped / 1024).toFixed(1)} kB gzipped`);
}
