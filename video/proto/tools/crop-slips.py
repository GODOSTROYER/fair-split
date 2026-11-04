# Cuts the paper out of the synthetic slip masters (media/masters, Codex-made, synthetic) for the opening prototype.
# Usage (from the worktree root): python video/proto/tools/crop-slips.py [--debug <png>]
# Finds the paper by colour (light, low-saturation paper vs the tan mat), keeps the largest blob, fits a
# four-corner polygon and unwarps it. Needs numpy and opencv-python.
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "media" / "masters"
OUT = ROOT / "video" / "proto" / "assets"

# name -> (master file, output width)
SLIPS = {
    "slip-0457-white": ("spike-0457-white.jpg", 760),
    "slip-0457-pink": ("spike-0457-pink.jpg", 760),
    "slip-0403": ("spike-0403.jpg", 1100),
    "slip-0419": ("spike-0419.jpg", 360),
    "slip-0436": ("spike-0436.jpg", 360),
    "slip-0458": ("spike-0458.jpg", 360),
    "slip-0462": ("spike-0462.jpg", 360),
    "slip-0467": ("spike-0467.jpg", 360),
    "slip-0471": ("spike-0471.jpg", 360),
}


def paper_quad(img: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.int32)
    L, a, b = lab[..., 0], lab[..., 1] - 128, lab[..., 2] - 128
    # Paper is light; the mat is yellow-brown (high b*). Pink paper has a* > 0 but low b*.
    mask = ((L > 175) & (b < 18)).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(contours, key=cv2.contourArea)
    hull = cv2.convexHull(c)
    peri = cv2.arcLength(hull, True)
    for eps in (0.01, 0.02, 0.03, 0.05, 0.08):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            break
    else:
        approx = cv2.boxPoints(cv2.minAreaRect(c)).reshape(-1, 1, 2)
    pts = approx.reshape(4, 2).astype(np.float32)
    s = pts.sum(1)
    d = pts[:, 0] - pts[:, 1]
    return np.array([pts[s.argmin()], pts[d.argmax()], pts[s.argmax()], pts[d.argmin()]], np.float32)


def main() -> int:
    debug = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--debug" else None
    OUT.mkdir(parents=True, exist_ok=True)
    tiles = []
    for name, (file, width) in SLIPS.items():
        img = cv2.imread(str(SRC / file))
        quad = paper_quad(img)
        c = quad.mean(0)
        quad = quad + (c - quad) / np.linalg.norm(c - quad, axis=1, keepdims=True) * 6  # trim the paper edge
        tl, tr, br, bl = quad
        w = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
        h = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
        height = round(width * h / w)
        dst = np.array([[0, 0], [width, 0], [width, height], [0, height]], np.float32)
        flat = cv2.warpPerspective(img, cv2.getPerspectiveTransform(quad, dst), (width, height), flags=cv2.INTER_AREA)
        cv2.imwrite(str(OUT / f"{name}.jpg"), flat, [cv2.IMWRITE_JPEG_QUALITY, 88])
        print(name, (width, height), quad.round().astype(int).tolist())
        if debug:
            d = img.copy()
            cv2.polylines(d, [quad.astype(np.int32)], True, (0, 0, 255), 8)
            tiles.append(cv2.resize(d, (300, round(300 * d.shape[0] / d.shape[1])))[:400])
    if debug:
        hmax = max(t.shape[0] for t in tiles)
        tiles = [cv2.copyMakeBorder(t, 0, hmax - t.shape[0], 0, 6, cv2.BORDER_CONSTANT) for t in tiles]
        cv2.imwrite(debug, np.hstack(tiles))
    return 0


if __name__ == "__main__":
    sys.exit(main())
