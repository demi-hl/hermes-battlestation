#!/usr/bin/env bash
set -e
UNIT="hermes-battlestation.service"
systemd-run --user --collect --unit="bsbounce-$$" systemctl --user restart "$UNIT"
sleep 6
systemctl --user is-active "$UNIT"
