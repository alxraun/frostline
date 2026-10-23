#!/usr/bin/env bash
# parents: @.frostline/graph/ss-distribution.xml, @.frostline/graph/ss-validation.xml
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if (($# != 2)); then echo "Usage: scripts/verify.sh {codex|dsh} PACKAGE_DIRECTORY" >&2; exit 2; fi
target=$1
package=$2
case "$target" in codex|dsh) ;; *) echo "Unknown target: $target" >&2; exit 2 ;; esac
[[ -x $package/bin/fli && -f $package/manifest.sha256 ]] || { echo "Incomplete package: Core or manifest missing" >&2; exit 1; }
[[ -f "$package/skills/frostline-graph/SKILL.md" ]] || { echo "Missing skill: frostline-graph" >&2; exit 1; }
[[ -f "$package/licenses/NOTICE.md" ]] || { echo "Missing third-party license notices: licenses/NOTICE.md" >&2; exit 1; }
grep -q '^| ' "$package/licenses/NOTICE.md" || { echo "License notice lists no crates" >&2; exit 1; }
while IFS= read -r -d '' text; do [[ -s $text ]] || { echo "Empty license text: $text" >&2; exit 1; }; done < <(find "$package/licenses" -type f -name '*.txt' -print0)
cmp "$root/packages/skills/frostline-graph/SKILL.md" "$package/skills/frostline-graph/SKILL.md"
(
  cd "$package"
  sha256sum --check --quiet manifest.sha256
  declared=$(sed -E 's/^[0-9a-fA-F]{64} [ *]//' manifest.sha256 | LC_ALL=C sort)
  actual=$(find . -type f ! -name manifest.sha256 -printf '%P\n' | LC_ALL=C sort)
  if [[ $declared != "$actual" ]]; then
    echo "package manifest is incomplete or contains stale entries" >&2
    exit 1
  fi
)
case "$target" in
  codex)
    [[ -x $package/bin/frostline-codex && -f $package/hooks/hooks.json && -f $package/.codex-plugin/plugin.json ]] ||
      { echo "Incomplete Codex plugin" >&2; exit 1; }
    ;;
  dsh)
    [[ -x $package/bin/fli-classify-reads && -f $package/lib/index.js &&
      -f $package/package.json && -f $package/cordis.patch.yml ]] ||
      { echo "Incomplete DSH bundle" >&2; exit 1; }
    node --check "$package/lib/index.js"
    deno eval 'const p=JSON.parse(await Deno.readTextFile(Deno.args[0])); if(p.name!=="@frostline/dsh" || p.dsh?.bundle?.patch!=="./cordis.patch.yml" || p.peerDependencies?.["@deepseek-ai/dsh"]!==p.frostline?.deepSeekHarness?.testedVersion) throw Error("Unverified DSH compatibility metadata");' "$package/package.json"
    ;;
esac
