#!/usr/bin/env bash
# E2E test: tokenizer credential management for local (podman) and k8s modes.
#
# Prerequisites:
#   - The installer dev server running on localhost:3000
#   - podman available (for local tests)
#   - kind cluster named "kind" with tokenizer image loaded (for k8s tests)
#
# Usage:
#   ./e2e/tokenizer.sh          # run all tests
#   ./e2e/tokenizer.sh local    # run only local tests
#   ./e2e/tokenizer.sh k8s      # run only k8s tests

set -uo pipefail

API="http://localhost:3000"
LOCAL_PORT=19701  # avoid colliding with any running instance
PASS=0
FAIL=0
ERRORS=""

# ── Helpers ──────────────────────────────────────────────────────────

log()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
pass() { PASS=$((PASS + 1)); printf "  \033[32m✓ %s\033[0m\n" "$*"; }
fail() { FAIL=$((FAIL + 1)); ERRORS="${ERRORS}\n  ✗ $*"; printf "  \033[31m✗ %s\033[0m\n" "$*"; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$label"
  else
    fail "$label (expected '$expected', got '$actual')"
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    pass "$label"
  else
    fail "$label (expected to contain '$needle')"
  fi
}

assert_no_secrets() {
  local label="$1" response="$2"
  local has_secret
  has_secret=$(echo "$response" | python3 -c "
import sys,json
data = json.load(sys.stdin)
creds = data.get('credentials', [])
print(any(c.get('secret','') != '' for c in creds))
" 2>/dev/null || echo "Error")
  if [ "$has_secret" = "False" ]; then
    pass "$label"
  else
    fail "$label (secrets found in response)"
  fi
}

# Poll GET /api/instances/:id until status matches target.
wait_for_status() {
  local id="$1" target="$2" timeout="${3:-120}"
  for _ in $(seq 1 "$timeout"); do
    local status
    status=$(curl -sf "$API/api/instances/$id" 2>/dev/null \
      | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
    if [ "$status" = "$target" ]; then return 0; fi
    sleep 1
  done
  return 1
}

# Poll GET /api/instances?includeK8s=1 until the namespace appears.
wait_for_k8s_instance() {
  local id="$1" timeout="${2:-180}"
  for _ in $(seq 1 "$timeout"); do
    local found
    found=$(curl -sf "$API/api/instances?includeK8s=1" 2>/dev/null \
      | python3 -c "import sys,json; print(any(i['id']=='$id' for i in json.load(sys.stdin)))" 2>/dev/null || true)
    if [ "$found" = "True" ]; then return 0; fi
    sleep 1
  done
  return 1
}

# Poll the k8s instance list until its status matches target.
wait_for_k8s_status() {
  local id="$1" target="$2" timeout="${3:-180}"
  for _ in $(seq 1 "$timeout"); do
    local status
    status=$(curl -sf "$API/api/instances?includeK8s=1" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); inst=[i for i in d if i['id']=='$id']; print(inst[0]['status'] if inst else '')" 2>/dev/null || true)
    if [ "$status" = "$target" ]; then return 0; fi
    sleep 1
  done
  return 1
}

# PUT credentials with retry on 409 (concurrent update lock).
put_credentials() {
  local id="$1" body="$2" timeout="${3:-30}"
  for _ in $(seq 1 "$timeout"); do
    local http_code resp
    resp=$(curl -s --max-time 30 -w "\n%{http_code}" -X PUT "$API/api/instances/$id/tokenizer" \
      -H 'Content-Type: application/json' -d "$body")
    http_code=$(echo "$resp" | tail -1)
    resp=$(echo "$resp" | sed '$d')
    if [ "$http_code" = "202" ]; then
      echo "$resp"
      return 0
    elif [ "$http_code" = "409" ]; then
      sleep 2
    else
      echo "$resp"
      return 1
    fi
  done
  echo "timeout waiting for lock"
  return 1
}

# Poll GET /api/instances/:id/tokenizer until credential count matches.
wait_for_cred_count() {
  local id="$1" expected="$2" timeout="${3:-60}"
  for _ in $(seq 1 "$timeout"); do
    local count
    count=$(curl -sf "$API/api/instances/$id/tokenizer" 2>/dev/null \
      | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('credentials',[])))" 2>/dev/null || true)
    if [ "$count" = "$expected" ]; then return 0; fi
    sleep 1
  done
  return 1
}

cleanup_local() {
  local name="$1"
  log "Cleanup: deleting local instance $name"
  # Stop first (may fail if already stopped)
  curl -sf -X POST "$API/api/instances/$name/stop" >/dev/null 2>&1 || true
  sleep 2
  curl -sf -X DELETE "$API/api/instances/$name" >/dev/null 2>&1 || true
}

cleanup_k8s() {
  local ns="$1"
  log "Cleanup: deleting k8s instance $ns"
  curl -sf -X DELETE "$API/api/instances/$ns" >/dev/null 2>&1 || true
}

# ── Local (podman) tests ─────────────────────────────────────────────

test_local() {
  local NAME="openclaw-e2etkz-local"
  cleanup_local "$NAME"
  sleep 2

  log "LOCAL: Deploy with tokenizer enabled and one initial credential"
  local deploy_resp
  deploy_resp=$(curl -sf --max-time 30 -X POST "$API/api/deploy" \
    -H 'Content-Type: application/json' \
    -d '{
      "mode": "local",
      "agentName": "local",
      "prefix": "e2etkz",
      "port": '"$LOCAL_PORT"',
      "tokenizerEnabled": true,
      "tokenizerCredentials": [
        {"name": "github", "secret": "test-secret-not-real-000", "allowedHosts": ["api.github.com"]}
      ]
    }')
  assert_contains "deploy accepted" "deployId" "$deploy_resp"

  log "LOCAL: Waiting for instance to be running..."
  if wait_for_status "$NAME" "running" 120; then
    pass "instance is running"
  else
    fail "instance did not reach running state"
    cleanup_local "$NAME"
    return
  fi

  # Verify tokenizerEnabled is reported in the instance list
  local tkz_enabled
  tkz_enabled=$(curl -sf "$API/api/instances" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); inst=[i for i in d if i['id']=='$NAME']; print(inst[0]['config'].get('tokenizerEnabled', False) if inst else False)")
  assert_eq "tokenizerEnabled in listing" "True" "$tkz_enabled"

  # Verify GET /tokenizer returns the initial credential
  log "LOCAL: Verify initial credential metadata"
  local cred_resp
  cred_resp=$(curl -sf "$API/api/instances/$NAME/tokenizer")
  local cred_count
  cred_count=$(echo "$cred_resp" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('credentials',[])))")
  assert_eq "one initial credential" "1" "$cred_count"
  local cred_name
  cred_name=$(echo "$cred_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['credentials'][0]['name'])")
  assert_eq "credential name is GITHUB" "GITHUB" "$cred_name"
  assert_no_secrets "no secrets in GET response" "$cred_resp"

  # ── Add a second credential ──
  log "LOCAL: Add a second credential (keep existing github, add stripe)"
  local update_resp
  update_resp=$(put_credentials "$NAME" '{
    "credentials": [
      {"name": "GITHUB", "secret": "", "allowedHosts": ["api.github.com"]},
      {"name": "stripe", "secret": "test-stripe-not-real-000", "allowedHosts": ["api.stripe.com"]}
    ]
  }')
  assert_contains "update accepted" "deployId" "$update_resp"

  log "LOCAL: Waiting for restart and credentials to update..."
  wait_for_status "$NAME" "running" 60 || true
  if wait_for_cred_count "$NAME" "2" 60; then
    pass "two credentials after add"
  else
    fail "credential count did not reach 2"
  fi

  cred_resp=$(curl -sf "$API/api/instances/$NAME/tokenizer")
  local cred_names
  cred_names=$(echo "$cred_resp" | python3 -c "import sys,json; print(','.join(sorted(c['name'] for c in json.load(sys.stdin)['credentials'])))")
  assert_eq "credential names" "GITHUB,STRIPE" "$cred_names"

  # ── Delete one credential ──
  log "LOCAL: Delete stripe credential (keep github only)"
  update_resp=$(put_credentials "$NAME" '{
    "credentials": [
      {"name": "GITHUB", "secret": "", "allowedHosts": ["api.github.com"]}
    ]
  }')
  assert_contains "delete-update accepted" "deployId" "$update_resp"

  log "LOCAL: Waiting for restart and credentials to update..."
  wait_for_status "$NAME" "running" 60 || true
  if wait_for_cred_count "$NAME" "1" 60; then
    pass "one credential after delete"
  else
    fail "credential count did not reach 1"
  fi

  cred_resp=$(curl -sf "$API/api/instances/$NAME/tokenizer")
  cred_name=$(echo "$cred_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['credentials'][0]['name'])")
  assert_eq "remaining credential is GITHUB" "GITHUB" "$cred_name"

  # ── Delete all credentials ──
  log "LOCAL: Delete all credentials"
  update_resp=$(put_credentials "$NAME" '{"credentials": []}')
  assert_contains "delete-all accepted" "deployId" "$update_resp"

  log "LOCAL: Waiting for restart and credentials to clear..."
  wait_for_status "$NAME" "running" 60 || true
  if wait_for_cred_count "$NAME" "0" 60; then
    pass "zero credentials after delete-all"
  else
    fail "credential count did not reach 0"
  fi

  # ── Cleanup ──
  cleanup_local "$NAME"
  log "LOCAL: Done"
}

# ── Kubernetes tests ─────────────────────────────────────────────────

test_k8s() {
  local NS="e2etkz-k8s-openclaw"
  cleanup_k8s "$NS"
  sleep 5

  log "K8S: Deploy with tokenizer enabled and one initial credential"
  local deploy_resp
  deploy_resp=$(curl -sf --max-time 30 -X POST "$API/api/deploy" \
    -H 'Content-Type: application/json' \
    -d '{
      "mode": "kubernetes",
      "agentName": "agent",
      "prefix": "e2etkz-k8s",
      "namespace": "'"$NS"'",
      "tokenizerEnabled": true,
      "tokenizerCredentials": [
        {"name": "github", "secret": "test-secret-not-real-000", "allowedHosts": ["api.github.com"]}
      ]
    }')
  assert_contains "deploy accepted" "deployId" "$deploy_resp"

  log "K8S: Waiting for instance to appear..."
  if wait_for_k8s_instance "$NS" 180; then
    pass "k8s instance discovered"
  else
    fail "k8s instance not found after 180s"
    cleanup_k8s "$NS"
    return
  fi

  log "K8S: Waiting for pods to be running..."
  if wait_for_k8s_status "$NS" "running" 180; then
    pass "k8s instance is running"
  else
    fail "k8s instance did not reach running state"
    cleanup_k8s "$NS"
    return
  fi

  # Verify GET /tokenizer returns the initial credential
  log "K8S: Verify initial credential metadata"
  local cred_resp
  cred_resp=$(curl -sf "$API/api/instances/$NS/tokenizer")
  local cred_count
  cred_count=$(echo "$cred_resp" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('credentials',[])))")
  assert_eq "one initial credential" "1" "$cred_count"
  local cred_name
  cred_name=$(echo "$cred_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['credentials'][0]['name'])")
  assert_eq "credential name is GITHUB" "GITHUB" "$cred_name"
  assert_no_secrets "no secrets in GET response" "$cred_resp"

  # ── Add a second credential ──
  log "K8S: Add a second credential (keep existing github, add stripe)"
  local update_resp
  update_resp=$(put_credentials "$NS" '{
    "credentials": [
      {"name": "GITHUB", "secret": "", "allowedHosts": ["api.github.com"]},
      {"name": "stripe", "secret": "test-stripe-not-real-000", "allowedHosts": ["api.stripe.com"]}
    ]
  }')
  assert_contains "update accepted" "deployId" "$update_resp"

  log "K8S: Waiting for pod restart and credentials to update..."
  sleep 5
  if wait_for_k8s_status "$NS" "running" 120; then
    pass "k8s instance running after credential add"
  else
    fail "k8s instance not running after credential add"
  fi

  if wait_for_cred_count "$NS" "2" 60; then
    pass "two credentials after add"
  else
    fail "credential count did not reach 2"
  fi

  cred_resp=$(curl -sf "$API/api/instances/$NS/tokenizer")
  local cred_names
  cred_names=$(echo "$cred_resp" | python3 -c "import sys,json; print(','.join(sorted(c['name'] for c in json.load(sys.stdin)['credentials'])))")
  assert_eq "credential names" "GITHUB,STRIPE" "$cred_names"

  # ── Delete one credential ──
  log "K8S: Delete stripe credential (keep github only)"
  update_resp=$(put_credentials "$NS" '{
    "credentials": [
      {"name": "GITHUB", "secret": "", "allowedHosts": ["api.github.com"]}
    ]
  }')
  assert_contains "delete-update accepted" "deployId" "$update_resp"

  sleep 5
  if wait_for_k8s_status "$NS" "running" 120; then
    pass "k8s instance running after credential delete"
  else
    fail "k8s instance not running after credential delete"
  fi

  if wait_for_cred_count "$NS" "1" 60; then
    pass "one credential after delete"
  else
    fail "credential count did not reach 1"
  fi

  cred_resp=$(curl -sf "$API/api/instances/$NS/tokenizer")
  cred_name=$(echo "$cred_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['credentials'][0]['name'])")
  assert_eq "remaining credential is GITHUB" "GITHUB" "$cred_name"

  # ── Delete all credentials ──
  log "K8S: Delete all credentials"
  update_resp=$(put_credentials "$NS" '{"credentials": []}')
  assert_contains "delete-all accepted" "deployId" "$update_resp"

  sleep 5
  if wait_for_k8s_status "$NS" "running" 120; then
    pass "k8s instance running after delete-all"
  else
    fail "k8s instance not running after delete-all"
  fi

  if wait_for_cred_count "$NS" "0" 60; then
    pass "zero credentials after delete-all"
  else
    fail "credential count did not reach 0"
  fi

  # ── Cleanup ──
  cleanup_k8s "$NS"
  log "K8S: Done"
}

# ── Main ─────────────────────────────────────────────────────────────

mode="${1:-all}"

case "$mode" in
  local) test_local ;;
  k8s)   test_k8s ;;
  all)   test_local; test_k8s ;;
  *)     echo "Usage: $0 [local|k8s|all]"; exit 1 ;;
esac

printf "\n\033[1m── Results ──\033[0m\n"
printf "  \033[32mPassed: %d\033[0m\n" "$PASS"
if [ "$FAIL" -gt 0 ]; then
  printf "  \033[31mFailed: %d\033[0m\n" "$FAIL"
  printf "\033[31m%b\033[0m\n" "$ERRORS"
  exit 1
else
  printf "  \033[31mFailed: 0\033[0m\n"
  printf "\n\033[32mAll tests passed!\033[0m\n"
fi
