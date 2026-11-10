# Makes assets/dapple.png: soft, out-of-focus leaf shadows (light through leaves) for the daylight act.
# Ink-tinted alpha only, very low contrast, so the backdrop gains depth without a new hue.
# Usage (from the worktree root): python video/proto/tools/make-dapple.py   (numpy + opencv-python)
from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parents[1] / "assets" / "dapple.png"
W, H = 1600, 900
rng = np.random.default_rng(20261104)

mask = np.zeros((H, W), np.float32)
# a canopy that is dense at the top right and opens towards the lower left (the light comes from there)
for _ in range(1500):
    x, y = rng.uniform(-120, W + 120), rng.uniform(-120, H + 120)
    p = np.clip(1.25 * (x / W) + 1.0 * (1 - y / H) - 0.8, 0, 1) ** 1.6
    if rng.random() > p:
        continue
    a = rng.uniform(16, 44)
    b = a * rng.uniform(0.32, 0.55)
    cv2.ellipse(mask, (int(x), int(y)), (int(a), int(b)), float(rng.uniform(0, 180)), 0, 360, 1.0, -1)
    # a few twigs
    if rng.random() < 0.05:
        ang = rng.uniform(0, np.pi)
        L = rng.uniform(80, 220)
        cv2.line(mask, (int(x), int(y)), (int(x + L * np.cos(ang)), int(y + L * np.sin(ang))), 1.0, 5)

soft = cv2.GaussianBlur(mask, (0, 0), 20)
soft = np.clip(soft, 0, 1)
alpha = (soft * 0.10 * 255).round().astype(np.uint8)
rgba = np.zeros((H, W, 4), np.uint8)
rgba[..., 0], rgba[..., 1], rgba[..., 2] = 32, 18, 11  # BGR of ink #0B1220
rgba[..., 3] = alpha
cv2.imwrite(str(OUT), rgba)
print(OUT, alpha.max(), round(float(alpha.mean()), 2))
# The film's capture run pans across 37,000 px of world: the same shadows with their mirror image beside them
# tile seamlessly along x (each edge meets its own reflection).
cv2.imwrite(str(OUT.with_name("dapple-tile.png")), np.hstack([rgba, rgba[:, ::-1]]))
