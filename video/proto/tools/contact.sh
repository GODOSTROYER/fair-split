#!/usr/bin/env bash
# Tiles 16 frames of out/opening.mp4 into out/contact.png (4 x 4), one per beat.
# Usage (from video/proto): bash tools/contact.sh [ffmpeg]
set -euo pipefail
FFMPEG="${1:-ffmpeg}"
#  1.0 hairline | 2.4 farmers  | 4.0 shoebox   | 7.0 fan
#  8.9 twice    | 10.6 once    | 12.4 gather   | 13.9 ring
# 15.0 portal   | 18.3 read    | 20.9 checked  | 22.3 glide
# 24.2 paid     | 26.5 trace   | 28.0 end line | 29.8 glide
FRAMES=(30 72 120 210 267 318 372 417 450 549 627 669 726 795 840 894)
SEL=""
for f in "${FRAMES[@]}"; do SEL="${SEL:+$SEL+}eq(n\,$f)"; done
"$FFMPEG" -y -loglevel error -i out/opening.mp4 \
  -vf "select='$SEL',scale=640:-1,tile=4x4:padding=8:margin=8:color=0x111111" \
  -frames:v 1 -fps_mode vfr out/contact.png
echo "out/contact.png"
