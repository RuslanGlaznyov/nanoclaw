#!/usr/bin/env bash
# Homelab local patches: check | apply | revert.
#
# A patch is a directory patches/<name>/ with:
#   README.md   why, the upstream PR, when to delete the patch
#   patch.diff  changes to files that upstream owns (git diff format, a/ b/ prefixes)
#   files/      optional: new files, by their path in the repository (for example tests)
#   check.sh    check.sh <work|upstream>: exit 0 when the change is already in that code
#
# Usage:
#   scripts/homelab/patches.sh check            table: patch, applied, in upstream, diff applies
#   scripts/homelab/patches.sh apply  [name...] apply the patches that are not applied yet
#   scripts/homelab/patches.sh revert [name...] remove the patches that are applied
#
# check exits 1 when a patch is not applied, so it can stop a script after an update.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
PATCHES_DIR="$ROOT/patches"
export HOMELAB_PATCH_LIB="$ROOT/scripts/homelab/patch-lib.sh"

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

list_patches() {
  [ -d "$PATCHES_DIR" ] || return 0
  find "$PATCHES_DIR" -mindepth 2 -maxdepth 2 -name check.sh -printf '%h\n' | xargs -r -n1 basename | sort
}

selected_patches() {
  if [ "$#" -gt 0 ]; then
    for name in "$@"; do
      [ -f "$PATCHES_DIR/$name/check.sh" ] || { echo "unknown patch: $name" >&2; exit 2; }
      echo "$name"
    done
  else
    list_patches
  fi
}

is_in() { bash "$PATCHES_DIR/$1/check.sh" "$2" >/dev/null 2>&1; }

new_files() {
  local dir="$PATCHES_DIR/$1/files"
  [ -d "$dir" ] || return 0
  (cd "$dir" && find . -type f -printf '%P\n' | sort)
}

cmd_check() {
  local names missing=0
  names="$(list_patches)"
  if [ -z "$names" ]; then
    echo "no patches in patches/"
    return 0
  fi
  printf '%-24s %-9s %-11s %s\n' PATCH APPLIED UPSTREAM DIFF
  for name in $names; do
    local applied=no upstream=no diff=-
    if is_in "$name" work; then applied=yes; else missing=1; fi
    if is_in "$name" upstream; then upstream=yes; fi
    if [ -f "$PATCHES_DIR/$name/patch.diff" ]; then
      if git apply --check "$PATCHES_DIR/$name/patch.diff" 2>/dev/null; then
        diff=applies
      elif git apply --check -R "$PATCHES_DIR/$name/patch.diff" 2>/dev/null; then
        diff=applied
      else
        diff=CONFLICT
      fi
    fi
    printf '%-24s %-9s %-11s %s\n' "$name" "$applied" "$upstream" "$diff"
  done
  if [ "$missing" -ne 0 ]; then
    echo
    echo "Some patches are not applied. Run: scripts/homelab/patches.sh apply"
  fi
  return "$missing"
}

cmd_apply() {
  for name in $(selected_patches "$@"); do
    local dir="$PATCHES_DIR/$name"
    if is_in "$name" work; then
      echo "$name: already applied"
      continue
    fi
    if is_in "$name" upstream; then
      echo "$name: upstream has this change. Delete patches/$name instead of applying it." >&2
      exit 1
    fi
    if [ -f "$dir/patch.diff" ]; then
      git apply --check "$dir/patch.diff" || {
        echo "$name: patch.diff does not apply. Move the change by hand, see $dir/README.md" >&2
        exit 1
      }
      git apply "$dir/patch.diff"
    fi
    for file in $(new_files "$name"); do
      mkdir -p "$(dirname "$file")"
      cp "$dir/files/$file" "$file"
    done
    is_in "$name" work || { echo "$name: applied, but check.sh still fails" >&2; exit 1; }
    echo "$name: applied"
  done
}

cmd_revert() {
  for name in $(selected_patches "$@"); do
    local dir="$PATCHES_DIR/$name"
    if ! is_in "$name" work; then
      echo "$name: not applied"
      continue
    fi
    if [ -f "$dir/patch.diff" ]; then
      git apply -R --check "$dir/patch.diff" || {
        echo "$name: patch.diff cannot be reverted cleanly" >&2
        exit 1
      }
      git apply -R "$dir/patch.diff"
    fi
    for file in $(new_files "$name"); do
      rm -f "$file"
    done
    echo "$name: reverted"
  done
}

case "${1:-}" in
  check) shift; cmd_check "$@" ;;
  apply) shift; cmd_apply "$@" ;;
  revert) shift; cmd_revert "$@" ;;
  *) usage ;;
esac
