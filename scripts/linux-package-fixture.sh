#!/usr/bin/env bash
set -euo pipefail

case "$1" in
  unpack)
    exec dpkg-deb -x "$2" "$3"
    ;;
  picker-window)
    exec xdotool search --onlyvisible --name '^选择工具工作目录$'
    ;;
  select-directory)
    xdotool windowfocus --sync "$2" key --clearmodifiers ctrl+l
    sleep 0.2
    xdotool type --clearmodifiers "$3"
    xdotool key --clearmodifiers Return
    sleep 0.5
    if xdotool search --onlyvisible --name '^选择工具工作目录$' >/dev/null; then
      exec xdotool key --clearmodifiers alt+o
    fi
    ;;
  check-absent|install|purge)
    test "${RUNNER_ENVIRONMENT:-}" = github-hosted
    case "$1" in
      check-absent)
        if dpkg-query -W pilot >/dev/null 2>&1; then
          echo 'The runner must start without a Pilot package' >&2
          exit 1
        fi
        test ! -e /opt/Pilot/pilot
        ;;
      install)
        sudo apt-get install -y --no-install-recommends "$2"
        test "$(dpkg-query -W -f='${db:Status-Status} ${Version}' pilot)" = "installed $3"
        ;;
      purge)
        sudo dpkg --purge pilot
        ;;
    esac
    ;;
  *)
    exit 2
    ;;
esac
