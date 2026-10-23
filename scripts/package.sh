#!/usr/bin/env bash
# parents: @.frostline/graph/ss-distribution.xml
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if (($# != 2)); then echo "Usage: scripts/package.sh {codex|dsh} OUTPUT_DIRECTORY" >&2; exit 2; fi
target=$1
output=$2
case "$target" in codex|dsh) ;; *) echo "Unknown target: $target" >&2; exit 2 ;; esac
if [[ -e $output ]]; then echo "Output path already exists: $output" >&2; exit 2; fi
core="$root/packages/core/bin/fli"
[[ -x $core ]] || { echo "Build Core first: $core" >&2; exit 1; }
case "$target" in
  codex)
    adapter="$root/integrations/codex/native/target/release/frostline-codex"
    [[ -x $adapter ]] || { echo "Build Codex adapter first: $adapter" >&2; exit 1; }
    mkdir -p "$output/bin" "$output/hooks" "$output/skills"
    cp "$core" "$output/bin/fli"
    cp "$adapter" "$output/bin/frostline-codex"
    cp "$root/integrations/codex/hooks/hooks.json" "$output/hooks/hooks.json"
    cp -R "$root/integrations/codex/.codex-plugin" "$output/.codex-plugin"
    ;;
  dsh)
    adapter="$root/integrations/deepseek-harness/lib/index.js"
    classifier="$root/packages/read-classifier/target/release/fli-classify-reads"
    [[ -f $adapter && -x $classifier ]] || { echo "Build DSH adapter and read classifier first" >&2; exit 1; }
    mkdir -p "$output/bin" "$output/lib" "$output/skills"
    cp "$core" "$output/bin/fli"
    cp "$classifier" "$output/bin/fli-classify-reads"
    cp "$adapter" "$output/lib/index.js"
    cp "$root/integrations/deepseek-harness/package.json" "$output/package.json"
    cp "$root/integrations/deepseek-harness/cordis.patch.yml" "$output/cordis.patch.yml"
    ;;
esac
cp -R "$root/packages/skills/." "$output/skills/"
deno run --allow-read --allow-write --allow-run "$root/scripts/licenses.ts" \
  --output "$output/licenses" \
  "$root/packages/read-classifier/Cargo.toml" \
  "$root/integrations/codex/native/Cargo.toml"
(
  cd "$output"
  LC_ALL=C find . -type f ! -name manifest.sha256 -printf '%P\0' |
    LC_ALL=C sort -z | xargs -0 sha256sum > manifest.sha256
)
