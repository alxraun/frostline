#!/usr/bin/env bash
# parents: @.frostline/graph/ss-distribution.xml
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if (($# < 1)); then echo "Usage: scripts/install-dev.sh {codex|dsh} [--profile NAME]" >&2; exit 2; fi
target=$1
shift
case "$target" in codex|dsh) ;; *) echo "Unknown target: $target" >&2; exit 2 ;; esac
profile=()
if [[ $target == dsh ]]; then
  # dsh plugin requires an explicit profile; Frostline never picks or creates one.
  if (($# != 2)) || [[ $1 != --profile || -z $2 ]]; then
    echo "Usage: scripts/install-dev.sh dsh --profile NAME (dsh plugin requires an explicit profile)" >&2
    exit 2
  fi
  profile=(--profile "$2")
elif (($#)); then
  echo "Usage: scripts/install-dev.sh {codex|dsh} [--profile NAME]" >&2
  exit 2
fi
data_root="${FLI_DEV_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/frostline}"
case "$target" in
  codex)
    marketplace="$data_root/codex-marketplace"
    destination="$marketplace/plugins/frostline"
    ;;
  dsh)
    destination="$data_root/dsh/package"
    ;;
esac
mkdir -p "$(dirname -- "$destination")"
stage=$(mktemp -d "$(dirname -- "$destination")/.frostline-stage.XXXXXX")
backup="$(dirname -- "$destination")/.frostline-previous.$$"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT
bash "$root/scripts/build.sh" "$target"
bash "$root/scripts/package.sh" "$target" "$stage/package"
bash "$root/scripts/verify.sh" "$target" "$stage/package"
if [[ $target == codex ]]; then
  mkdir -p "$marketplace/.agents/plugins"
  cat > "$marketplace/.agents/plugins/marketplace.json" <<'JSON'
{
  "name": "frostline-local",
  "interface": { "displayName": "Frostline Development" },
  "plugins": [{
    "name": "frostline",
    "source": { "source": "local", "path": "./plugins/frostline" },
    "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
    "category": "Productivity"
  }]
}
JSON
fi
[[ ! -e $backup ]] || { echo "Stale backup exists: $backup" >&2; exit 1; }
restore() {
  if [[ -e $backup ]]; then
    rm -rf "$destination"
    mv "$backup" "$destination"
  fi
}
if [[ -e $destination ]]; then mv "$destination" "$backup"; fi
if ! mv "$stage/package" "$destination"; then
  restore
  exit 1
fi
case "$target" in
  codex)
    if ! { codex plugin marketplace add "$marketplace" && codex plugin add frostline@frostline-local; }; then
      restore
      exit 1
    fi
    ;;
  dsh)
    if ! dsh plugin "${profile[@]}" add --force "link:$destination"; then
      restore
      exit 1
    fi
    ;;
esac
rm -rf "$backup"
echo "Installed development $target bundle. Restart its session to activate it."
