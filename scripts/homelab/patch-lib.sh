# Helpers for patches/<name>/check.sh. Source this file:
#   . "$(git rev-parse --show-toplevel)/scripts/homelab/patch-lib.sh"
#
# read_file <where> <ref> <path>
#   where=work      print the file from the working tree
#   where=upstream  print the file from the git ref <ref> (for example upstream/main)
# Prints nothing when the file does not exist.
read_file() {
  local where="$1" ref="$2" path="$3"
  if [ "$where" = work ]; then
    cat "$path" 2>/dev/null || true
  else
    git show "$ref:$path" 2>/dev/null || true
  fi
}

# has_marker <where> <ref> <path> <fixed string>
has_marker() {
  read_file "$1" "$2" "$3" | grep -qF -- "$4"
}
