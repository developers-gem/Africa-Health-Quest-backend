#!/usr/bin/env bash
# Kept for existing docs/commands: the mobile end-to-end test now prepares its own backend and data.
exec "$(dirname "$0")/run-e2e.sh" "$@"
