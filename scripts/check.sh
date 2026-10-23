#!/usr/bin/env bash
# parents: @.frostline/graph/ss-validation.xml
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
git -C "$root" diff --check
while IFS= read -r -d '' script; do bash -n "$script"; done < <(find "$root/scripts" -type f -name '*.sh' -print0)
deno fmt --check "$root/packages/core/src" "$root/integrations/deepseek-harness/src" "$root/tests"
deno lint "$root/packages/core/src" "$root/integrations/deepseek-harness/src" "$root/tests"
deno check "$root/packages/core/src/cli.ts" "$root/integrations/deepseek-harness/src/index.ts"
for manifest in "$root/packages/read-classifier/Cargo.toml" "$root/integrations/codex/native/Cargo.toml"; do
  cargo fmt --manifest-path "$manifest" -- --check
  cargo clippy --manifest-path "$manifest" --locked --all-targets -- -D warnings
done
