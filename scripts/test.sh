#!/usr/bin/env bash
# parents: @.frostline/graph/ss-validation.xml
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/frostline-test.XXXXXX")
baseline=$(git -C "$root" status --porcelain --untracked-files=all)
# Intermediate build outputs are disposable, but artifacts that already existed
# before this run belong to the developer and are left in place afterwards.
core_bin="$root/packages/core/bin"
adapter_lib="$root/integrations/deepseek-harness/lib"
had_core_bin=0
had_adapter_lib=0
[[ ! -e $core_bin ]] || had_core_bin=1
[[ ! -e $adapter_lib ]] || had_adapter_lib=1
cleanup() {
  rm -rf "$work"
  ((had_core_bin)) || rm -rf "$core_bin"
  ((had_adapter_lib)) || rm -rf "$adapter_lib"
}
trap cleanup EXIT
bash "$root/scripts/check.sh"
bash "$root/scripts/build.sh" all
cargo test --manifest-path "$root/packages/read-classifier/Cargo.toml" --locked --offline
deno test --allow-all "$root/tests"
bash "$root/scripts/package.sh" codex "$work/codex"
bash "$root/scripts/package.sh" dsh "$work/dsh"
bash "$root/scripts/verify.sh" codex "$work/codex"
bash "$root/scripts/verify.sh" dsh "$work/dsh"
first_codex="$work/codex/manifest.sha256"
first_dsh="$work/dsh/manifest.sha256"
rm -rf "$core_bin" "$adapter_lib"
bash "$root/scripts/build.sh" all
bash "$root/scripts/package.sh" codex "$work/codex-again"
bash "$root/scripts/package.sh" dsh "$work/dsh-again"
cmp "$first_codex" "$work/codex-again/manifest.sha256"
cmp "$first_dsh" "$work/dsh-again/manifest.sha256"
cleanup
trap - EXIT
after=$(git -C "$root" status --porcelain --untracked-files=all)
[[ $after == "$baseline" ]] || { echo "Tests modified tracked repository state" >&2; exit 1; }
