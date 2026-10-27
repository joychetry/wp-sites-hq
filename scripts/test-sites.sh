#!/usr/bin/env bash
# Test sites for Monks Central in WordPress Studio.
#
#   scripts/test-sites.sh create|start|stop|status|delete [mc-a|mc-b|mc-c ...]
#
#   mc-a  Classic Monks from a branch of ~/Documents/GitHub/classic-monks
#         (CM_BRANCH, default feat/hq) + WooCommerce
#   mc-b  Classic Monks as released (CM_RELEASE_REF, default main, 2.5.0),
#         without the new abilities (degraded mode). Not on wordpress.org yet.
#   mc-c  No Classic Monks (Basic mode); an application password is saved to
#         $STATE_DIR/mc-c.app-password (0600), never printed
#
# Only ever touches these three sites. Studio picks free ports itself.
# On Linux with no polkit agent, Studio's own /etc/hosts edit (pkexec) hangs,
# so this script writes the hosts entry inside Studio's block with sudo first.
set -Eeuo pipefail

SITES_ROOT="${SITES_ROOT:-$HOME/Studio}"
CM_REPO="${CM_REPO:-$HOME/Documents/GitHub/classic-monks}"
CM_BRANCH="${CM_BRANCH:-feat/hq}"
CM_RELEASE_REF="${CM_RELEASE_REF:-main}"
STATE_DIR="${STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/monks-central/test-sites}"
HOSTS="${HOSTS:-/etc/hosts}"
SUDO="${SUDO-sudo}"
ALL_SITES=(mc-a mc-b mc-c)
MIN_WP="7.1"

say() { printf '%s\n' "$*"; }
die() { printf 'test-sites: %s\n' "$*" >&2; exit 1; }
trap 'die "failed (exit $?) at line $LINENO: $BASH_COMMAND"' ERR

site_path() { printf '%s/%s' "$SITES_ROOT" "$1"; }
domain() { printf '%s.local' "$1"; }

# Field from `studio site list` for the site at our path; empty if unknown.
site_field() {
  studio site list --format json 2>/dev/null | python3 -c '
import json, sys
path, field = sys.argv[1], sys.argv[2]
for s in json.load(sys.stdin):
    if s["path"] == path:
        print(s.get(field, ""))
' "$(site_path "$1")" "$2"
}

wp() { local site=$1; shift; studio wp --path "$(site_path "$site")" "$@"; }

# Add "127.0.0.1/::1 <domain> # Port N" inside Studio's block, once.
hosts_add() {
  local d port
  d=$(domain "$1"); port=$2
  grep -qE "[[:space:]]$d([[:space:]]|$)" "$HOSTS" && return 0
  say "  hosts: adding $d (port $port), needs sudo"
  if grep -q '^# END WordPress Studio' "$HOSTS"; then
    $SUDO sed -i "/^# END WordPress Studio/i 127.0.0.1 $d # Port $port\n::1 $d # Port $port" "$HOSTS"
  else
    printf '# BEGIN WordPress Studio\n127.0.0.1 %s # Port %s\n::1 %s # Port %s\n# END WordPress Studio\n' \
      "$d" "$port" "$d" "$port" | $SUDO tee -a "$HOSTS" >/dev/null
  fi
}

hosts_remove() {
  local d; d=$(domain "$1")
  grep -qE "[[:space:]]$d([[:space:]]|$)" "$HOSTS" || return 0
  say "  hosts: removing $d, needs sudo"
  $SUDO sed -i "/^\(127\.0\.0\.1\|::1\) $d # Port [0-9]*$/d" "$HOSTS"
}

version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

wait_up() {
  local url; url="https://$(domain "$1")/"
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null "$url" 2>/dev/null && return 0
    sleep 2
  done
  die "$url did not answer"
}

start() {
  local site=$1 port
  port=$(site_field "$site" port)
  [ -n "$port" ] || die "$site does not exist; run: $0 create $site"
  hosts_add "$site" "$port"
  if [ "$(site_field "$site" running)" != "True" ]; then
    studio site start --path "$(site_path "$site")" --skip-browser --skip-log-details >/dev/null
  fi
  wait_up "$site"
}

# Classic Monks from a git ref of $CM_REPO (read-only: git archive).
install_cm() {
  local site=$1 ref=$2 dir
  dir="$(site_path "$site")/wp-content/plugins/classic-monks"
  git -C "$CM_REPO" rev-parse --verify --quiet "$ref^{commit}" >/dev/null \
    || die "$ref not found in $CM_REPO"
  rm -rf "$dir" && mkdir -p "$dir"
  git -C "$CM_REPO" archive "$ref" | tar -x -C "$dir"
  say "  Classic Monks from $ref ($(git -C "$CM_REPO" rev-parse --short "$ref"))"
  wp "$site" plugin activate classic-monks >/dev/null
}

create() {
  local site=$1 path; path=$(site_path "$site")
  if [ -n "$(site_field "$site" port)" ]; then
    say "$site: exists"
  else
    [ -e "$path" ] && die "$path exists but is not a Studio site; not touching it"
    say "$site: creating"
    studio site create --path "$path" --name "$site" --domain "$(domain "$site")" --https \
      --no-start --skip-browser --skip-log-details >/dev/null
  fi
  start "$site"

  local v; v=$(wp "$site" core version)
  version_ge "$v" "$MIN_WP" || die "$site runs WordPress $v; Monks Central needs $MIN_WP or newer"
  # Studio sites default to "local"; Basic mode and M3 rely on it.
  [ "$(wp "$site" eval 'echo wp_get_environment_type();')" = local ] \
    || die "$site is not WP_ENVIRONMENT_TYPE=local"

  case $site in
    mc-a)
      install_cm "$site" "$CM_BRANCH"
      wp "$site" plugin install woocommerce --activate >/dev/null
      ;;
    mc-b)
      install_cm "$site" "$CM_RELEASE_REF"
      ;;
    mc-c)
      local user file; user=$(site_field "$site" adminUsername); file="$STATE_DIR/mc-c.app-password"
      if [ ! -s "$file" ]; then
        mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"
        ( umask 077; wp "$site" user application-password create "${user:-admin}" monks-central --porcelain > "$file" )
        say "  application password for ${user:-admin} saved to $file"
      fi
      ;;
  esac
  status "$site"
}

status() {
  local site=$1
  if [ -z "$(site_field "$site" port)" ]; then say "$site: not created"; return; fi
  if [ "$(site_field "$site" running)" != "True" ]; then say "$site: stopped"; return; fi
  local plugins
  plugins=$(wp "$site" plugin list --status=active --field=name 2>/dev/null | paste -sd, -)
  say "$site: https://$(domain "$site")  WordPress $(wp "$site" core version)  port $(site_field "$site" port)  active: ${plugins:-none}"
}

stop() {
  [ -z "$(site_field "$1" port)" ] && return 0
  studio site stop --path "$(site_path "$1")" >/dev/null && say "$1: stopped"
}

delete() {
  local site=$1
  if [ -n "$(site_field "$site" port)" ]; then
    studio delete "$(site_path "$site")" >/dev/null
    say "$site: deleted (files moved to trash)"
  fi
  hosts_remove "$site"
  [ "$site" = mc-c ] && rm -f "$STATE_DIR/mc-c.app-password"
  return 0
}

main() {
  local cmd=${1:-}; shift || true
  case $cmd in create|start|stop|status|delete) ;; *) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;; esac
  command -v studio >/dev/null || die "the studio CLI is not on PATH"
  local sites=("$@"); [ ${#sites[@]} -gt 0 ] || sites=("${ALL_SITES[@]}")
  for s in "${sites[@]}"; do
    case $s in mc-a|mc-b|mc-c) ;; *) die "unknown site $s (only mc-a, mc-b, mc-c)" ;; esac
  done
  for s in "${sites[@]}"; do "$cmd" "$s"; done
}

if [ "${TEST_SITES_LIB:-}" != 1 ]; then main "$@"; fi
