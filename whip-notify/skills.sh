#!/usr/bin/env sh
# Shared by the Herdr build hook, local installer and app uninstall over SSH.
set -eu
umask 077
notify_skill_action=${notify_skill_action:-${1:-install}}
# Serialize local installers and app cleanup without depending on flock (macOS).
notify_skill_lock="$HOME/.whip-notify-skills.lock"
notify_skill_attempt=0
until mkdir "$notify_skill_lock" 2>/dev/null; do
  notify_skill_attempt=$((notify_skill_attempt + 1))
  # Owner directories make removal conditional on the observed PID, so two
  # recoverers cannot remove a replacement installer's ownership marker.
  for notify_owner in "$notify_skill_lock"/*; do
    notify_pid=${notify_owner##*/}
    case "$notify_pid" in ''|*[!0-9]*) continue ;; esac
    if ! kill -0 "$notify_pid" 2>/dev/null; then
      rmdir "$notify_owner" 2>/dev/null && rmdir "$notify_skill_lock" 2>/dev/null || :
    fi
  done
  if [ "$notify_skill_attempt" -ge 5 ]; then
    # Recover empty locks left by the old script, or death before publishing PID.
    if rmdir "$notify_skill_lock" 2>/dev/null; then continue; fi
    echo 'Another skill installation is running; retry after it finishes' >&2
    exit 1
  fi
  sleep 1
done
mkdir "$notify_skill_lock/$$"
trap 'rmdir "$notify_skill_lock/$$"; rmdir "$notify_skill_lock"' EXIT
trap 'exit 1' HUP INT TERM
if [ "$notify_skill_action" = install ]; then
  notify_skill_root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
fi
case "$notify_skill_action" in
  install)
    # Check and skip each user-owned destination independently.
    for notify_scope in "$HOME/.claude" "$HOME/.agents"; do
      notify_skill_dir="$notify_scope/skills/call-human"
      for notify_path in "$notify_scope" "$notify_scope/skills" "$notify_skill_dir" "$notify_skill_dir/SKILL.md" "$notify_skill_dir/.whip-notify"; do
        if [ -L "$notify_path" ]; then
          echo 'Preserving a symlinked call-human skill location' >&2
          continue 2
        fi
      done
      if [ -e "$notify_skill_dir" ]; then
        if [ ! -f "$notify_skill_dir/.whip-notify" ] ||
           [ ! -f "$notify_skill_dir/SKILL.md" ] ||
           ! cmp -s "$notify_skill_dir/SKILL.md" "$notify_skill_dir/.whip-notify"; then
          echo 'Preserving an existing or edited call-human skill' >&2
          continue
        fi
      fi
      mkdir -p "$notify_skill_dir"
      chmod 700 "$notify_skill_dir"
      install -m 600 "$notify_skill_root/call-human/SKILL.md" "$notify_skill_dir/SKILL.md"
      install -m 600 "$notify_skill_root/call-human/SKILL.md" "$notify_skill_dir/.whip-notify"
    done
    ;;
  uninstall)
    for notify_scope in "$HOME/.claude" "$HOME/.agents"; do
      notify_skill_dir="$notify_scope/skills/call-human"
      if [ ! -L "$notify_skill_dir" ] &&
         [ ! -L "$notify_skill_dir/SKILL.md" ] &&
         [ ! -L "$notify_skill_dir/.whip-notify" ] &&
         [ -f "$notify_skill_dir/.whip-notify" ] &&
         [ -f "$notify_skill_dir/SKILL.md" ] &&
         cmp -s "$notify_skill_dir/SKILL.md" "$notify_skill_dir/.whip-notify"; then
        rm -f "$notify_skill_dir/SKILL.md" "$notify_skill_dir/.whip-notify"
        # Preserve any extra user files inside the directory.
        rmdir "$notify_skill_dir" 2>/dev/null || :
      fi
    done
    ;;
  *) echo 'Expected install or uninstall' >&2; exit 1 ;;
esac
