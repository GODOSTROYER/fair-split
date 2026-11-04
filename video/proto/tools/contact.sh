#!/usr/bin/env bash
# Tiles 12 frames of out/opening.mp4 into out/contact.png (4 x 3), one per beat.
# Usage (from video/proto): bash tools/contact.sh [ffmpeg]
set -euo pipefail
FFMPEG="${1:-ffmpeg}"
# 2.4 farmers | 7.4 fan | 8.9 pink copy | 10.6 count once | 13.9 ring | 15.3 turn
# 18.4 read | 20.9 checked | 23.9 paid | 26.8 trace | 28.0 end line | 29.8 name
FRAMES=(72 222 267 318 417 459 552 627 717 804 840 894)
SEL=""
for f in "${FRAMES[@]}"; do SEL="${SEL:+$SEL+}eq(n\,$f)"; done
"$FFMPEG" -y -loglevel error -i out/opening.mp4 \
  -vf "select='$SEL',scale=640:-1,tile=4x3:padding=8:margin=8:color=0x111111" \
  -frames:v 1 -fps_mode vfr out/contact.png
echo "out/contact.png"
