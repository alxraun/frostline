#!/usr/bin/env bash
# parents: @.frostline/graph/ss-distribution.xml
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if (($# != 0)); then echo "Usage: scripts/release.sh" >&2; exit 2; fi
[[ -z $(git -C "$root" status --porcelain --untracked-files=all) ]] ||
  { echo "Release requires a clean working tree" >&2; exit 1; }
version=$(deno eval 'const p=JSON.parse(await Deno.readTextFile(Deno.args[0])); console.log(p.version)' "$root/integrations/deepseek-harness/package.json")
deno eval 'const p=JSON.parse(await Deno.readTextFile(Deno.args[0]));if(p.version!==Deno.args[1]) throw Error("Codex and DSH package versions differ")' "$root/integrations/codex/.codex-plugin/plugin.json" "$version"
command -v npm >/dev/null || { echo "npm is required for producing the DSH tarball" >&2; exit 1; }
bash "$root/scripts/test.sh"
bash "$root/scripts/build.sh" all
output="$root/dist/releases/$version"
[[ ! -e $output ]] || { echo "Release already staged: $output" >&2; exit 1; }
mkdir -p "$root/dist/releases"
staging=$(mktemp -d "$root/dist/releases/.stage-$version.XXXXXX")
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/codex-marketplace/plugins" "$staging/codex-marketplace/.agents/plugins"
bash "$root/scripts/package.sh" codex "$staging/codex-marketplace/plugins/frostline"
bash "$root/scripts/package.sh" dsh "$staging/dsh-bundle"
bash "$root/scripts/verify.sh" codex "$staging/codex-marketplace/plugins/frostline"
bash "$root/scripts/verify.sh" dsh "$staging/dsh-bundle"
cat > "$staging/codex-marketplace/.agents/plugins/marketplace.json" <<'JSON'
{
  "name": "frostline",
  "interface": { "displayName": "Frostline" },
  "plugins": [{
    "name": "frostline",
    "source": { "source": "local", "path": "./plugins/frostline" },
    "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
    "category": "Productivity"
  }]
}
JSON
(cd "$staging/dsh-bundle" && npm pack --ignore-scripts --pack-destination "$staging" --silent)
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -czf "$staging/frostline-codex-marketplace-$version.tar.gz" -C "$staging/codex-marketplace" .
(cd "$staging" && sha256sum ./*.tgz ./*.tar.gz > SHA256SUMS)
trap - EXIT
mv "$staging" "$output"
echo "Release artifacts staged at $output (not published)."
