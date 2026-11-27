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
  select-directory)
    xdotool windowfocus --sync "$2"
    sleep 0.2
    xdotool key --clearmodifiers ctrl+l ctrl+a
    xdotool type --clearmodifiers --delay 20 "$3"
    read -r width height < <(xdotool getwindowgeometry --shell "$2" | awk -F= '
      $1 == "WIDTH" { width = $2 }
      $1 == "HEIGHT" { height = $2 }
      END { print width, height }
    ')
    # GTK's Return key in the location field can close the chooser without selecting a folder.
    # The stock GTK chooser on the Xvfb desktop places Open at the bottom right.
    exec xdotool mousemove --window "$2" "$((width - 50))" "$((height - 22))" click 1
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
