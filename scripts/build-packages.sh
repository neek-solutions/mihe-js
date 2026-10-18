#!/usr/bin/env bash
#
# Build @mihe-dev/protocol, @mihe-dev/js and @mihe-dev/react into publishable packages.
#
#   sdk/scripts/build-packages.sh        # → sdk/dist-packages/{protocol,js,react}
#   npm publish ./sdk/dist-packages/protocol
#   npm publish ./sdk/dist-packages/js
#   npm publish ./sdk/dist-packages/react
#
# @mihe-dev/js also gets two self-contained files (scripts/bundle-js.mjs), so a
# page with no bundler can load it from a CDN or a static folder.
#
# The repo keeps developing against the TypeScript source, which the tests
# and local integrations use directly. What npm needs is different,
# because most apps don't compile TypeScript inside node_modules: compiled
# ES modules, declaration files, a manifest pointing at them, and
# "use client" so a Next.js server component can import the provider.
#
# So this builds a separate copy rather than repointing the source packages,
# which would break both of those consumers. Nothing here runs on install;
# it's run deliberately before a publish.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/dist-packages"
tsc="$root/node_modules/.bin/tsc"
[ -x "$tsc" ] || { echo "Run npm install in sdk/ first." >&2; exit 1; }

rm -rf "$out"

build_one() {
  local source="$1" target="$2"
  "$tsc" -p "$root/$source/tsconfig.build.json" --outDir "$out/$target/dist"
  node "$root/scripts/finish-package.mjs" "$root/$source" "$out/$target"
}

# In dependency order: each build resolves the types of the one before it
# from that one's output.
build_one protocol protocol
build_one js js
build_one react react

# @mihe-dev/js also ships as single files, for pages with no build step.
echo "Single files:"
node "$root/scripts/bundle-js.mjs" "$out/js/dist"

echo "Built:"
for package in protocol js react; do
  node -e "const p=require('$out/$package/package.json'); console.log('  ' + p.name + '@' + p.version + '  ' + '$out/$package')"
done
