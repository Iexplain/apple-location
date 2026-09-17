#!/bin/sh
set -eu

IPTABLES=/sbin/iptables

add_rule() {
  table=$1
  shift
  if ! "$IPTABLES" -w -t "$table" -C "$@" 2>/dev/null; then
    "$IPTABLES" -w -t "$table" -A "$@"
  fi
}

ensure_rule_first() {
  table=$1
  shift
  chain=$1
  shift
  # Delete stale copies wherever they occur, then put one copy at the top.
  while "$IPTABLES" -w -t "$table" -C "$chain" "$@" 2>/dev/null; do
    "$IPTABLES" -w -t "$table" -D "$chain" "$@"
  done
  "$IPTABLES" -w -t "$table" -I "$chain" 1 "$@"
}

# The VPN client pool must be able to reach the internet through the host.
sysctl -q -w net.ipv4.ip_forward=1
add_rule nat POSTROUTING -s 10.8.1.0/24 -o eth0 -j MASQUERADE
add_rule filter FORWARD -s 10.8.1.0/24 -j ACCEPT
add_rule filter FORWARD -d 10.8.1.0/24 -j ACCEPT

# WLOC traffic must be handled before Docker's PREROUTING jump. Keep this
# rule idempotent and at the first position so Docker cannot claim port 443.
# Keep the broad SNI fallback below the exact VPN-destination DNAT rule.
ensure_rule_first nat PREROUTING \
  -p tcp --dport 443 -m string --string gs-loc --algo bm \
  -j REDIRECT --to-ports 8445
ensure_rule_first nat PREROUTING \
  -s 10.8.1.0/24 -d 10.8.1.1/32 -p tcp --dport 443 \
  -j DNAT --to-destination 127.0.0.1:8445
