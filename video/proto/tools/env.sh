# Offline HyperFrames environment for this prototype (source it: `. tools/env.sh` from video/proto).
# Cached headless Chromium, the WinGet ffmpeg, no update checks, no downloads.
export npm_config_prefer_offline=true HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_NO_AUTO_INSTALL=1 DO_NOT_TRACK=1
export HYPERFRAMES_BROWSER_PATH="$LOCALAPPDATA/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe"
export HYPERFRAMES_FFMPEG_PATH=C:/Users/user/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe
export HYPERFRAMES_FFPROBE_PATH=C:/Users/user/AppData/Local/Microsoft/WinGet/Links/ffprobe.exe
HF="npx --yes hyperframes@0.8.157"
