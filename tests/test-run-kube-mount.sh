#!/usr/bin/env bash
# Regression test: Linux containerized installer runs must mount ~/.kube/config.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}FAIL${NC}: $1 - $2"; FAIL=$((FAIL + 1)); }

extract_kube_mount_block() {
  awk '
    /^# Mount kube config/ { capture = 1 }
    capture { print }
    capture && /^fi$/ { exit }
  ' "$REPO_DIR/run.sh"
}

run_kube_mount_block() {
  local home_dir="$1"
  local harness
  harness="$(extract_kube_mount_block)"
  HOME="$home_dir" bash -c "$harness"'
if [ "${#KUBE_MOUNT_FLAGS[@]}" -gt 0 ]; then
  printf "%s\n" "${KUBE_MOUNT_FLAGS[@]}"
fi
'
}

test_mounts_default_kube_config() {
  local temp_home
  temp_home="$(mktemp -d)"
  mkdir -p "$temp_home/.kube"
  touch "$temp_home/.kube/config"

  local output
  output="$(run_kube_mount_block "$temp_home")"
  rm -rf "$temp_home"

  local expected="-v
$temp_home/.kube:/home/node/.kube:ro,Z"
  if [ "$output" = "$expected" ]; then
    pass "Mounts ~/.kube read-only with SELinux relabeling at the container default kube path"
  else
    fail "Mounts ~/.kube read-only with SELinux relabeling at the container default kube path" "got: $output"
  fi
}

test_skips_missing_kube_config() {
  local temp_home
  temp_home="$(mktemp -d)"

  local output
  output="$(run_kube_mount_block "$temp_home")"
  rm -rf "$temp_home"

  if [ -z "$output" ]; then
    pass "Skips kube mount when ~/.kube/config is absent"
  else
    fail "Skips kube mount when ~/.kube/config is absent" "got: $output"
  fi
}

test_read_only_mounts_include_selinux_relabel() {
  local bad_lines
  bad_lines="$(
    awk '
      /:ro/ && !/:ro,Z/ { print FNR ":" $0 }
    ' "$REPO_DIR/run.sh"
  )"

  if [ -z "$bad_lines" ]; then
    pass "All read-only run.sh bind mounts include SELinux relabeling"
  else
    fail "All read-only run.sh bind mounts include SELinux relabeling" "missing ,Z on: $bad_lines"
  fi
}

test_linux_podman_run_preserves_host_user_mapping() {
  if grep -q -- "--userns=keep-id:uid=1000,gid=0" "$REPO_DIR/run.sh"; then
    pass "Linux podman run preserves host user mapping for node-owned bind mounts"
  else
    fail "Linux podman run preserves host user mapping for node-owned bind mounts" "missing --userns=keep-id:uid=1000,gid=0"
  fi
}

echo "=== run.sh kube mount tests ==="
echo ""

test_mounts_default_kube_config
test_skips_missing_kube_config
test_read_only_mounts_include_selinux_relabel
test_linux_podman_run_preserves_host_user_mapping

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
