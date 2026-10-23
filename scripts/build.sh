#!/usr/bin/env bash
# parents: @.frostline/graph/ss-distribution.xml
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
target=${1:-all}
case "$target" in codex|dsh|all) ;; *) echo "Usage: scripts/build.sh [codex|dsh|all]" >&2; exit 2 ;; esac
if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  echo "unsupported FLI build target; current release target is Linux/x86_64" >&2
  exit 2
fi
(cd "$root/packages/core" && deno task build)
if [[ $target == codex || $target == all ]]; then
  cargo build --manifest-path "$root/integrations/codex/native/Cargo.toml" --locked --release
fi
if [[ $target == dsh || $target == all ]]; then
  cargo build --manifest-path "$root/packages/read-classifier/Cargo.toml" --locked --release --bin fli-classify-reads
  (
    cd "$root/integrations/deepseek-harness"
    deno bundle --no-config --check --platform=deno -o lib/index.js src/index.ts
  )
  node --check "$root/integrations/deepseek-harness/lib/index.js"
fi
