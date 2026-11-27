#!/usr/bin/env bash
set -euo pipefail

case "$1" in
  unpack)
    exec dpkg-deb -x "$2" "$3"
    ;;
  picker-window)
    exec xdotool search --onlyvisible --name '^选择工具工作目录$'
    ;;
  cancel-directory)
    exec xdotool windowfocus --sync "$2" key --clearmodifiers Escape
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
