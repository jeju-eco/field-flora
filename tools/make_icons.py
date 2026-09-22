"""앱 아이콘(PNG) 생성 — 끝이 뾰족한 잎 모티브. Pillow 사용."""
from __future__ import annotations

import os

from PIL import Image, ImageChops, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "icons")
BG = (20, 83, 45)
LEAF = (63, 174, 107)
VEIN = (12, 48, 27)
RESAMPLE = getattr(getattr(Image, "Resampling", Image), "LANCZOS")


def leaf_mask(S: int) -> Image.Image:
    """두 개의 큰 원을 교차시켜 위아래 끝이 뾰족한 잎(vesica) 형태를 만든다."""
    # 반지름 R인 두 원의 중심을 좌우로 d만큼 벌리면 교집합이 렌즈 모양이 된다.
    # 교집합의 세로 반경은 sqrt(R^2 - (d/2)^2). 이것이 S*0.42 이하가 되도록 잡아
    # 아이콘 상하에 여백을 남긴다.
    R = S * 0.52
    d = S * 0.46  # 중심 간 거리(클수록 가늘고 뾰족)
    cy = S * 0.50
    left = Image.new("L", (S, S), 0)
    ImageDraw.Draw(left).ellipse(
        (S / 2 - d / 2 - R, cy - R, S / 2 - d / 2 + R, cy + R), fill=255
    )
    right = Image.new("L", (S, S), 0)
    ImageDraw.Draw(right).ellipse(
        (S / 2 + d / 2 - R, cy - R, S / 2 + d / 2 + R, cy + R), fill=255
    )
    return ImageChops.multiply(left, right)


def make(size: int) -> Image.Image:
    S = size * 4  # supersample
    mask = leaf_mask(S)
    img = Image.new("RGB", (S, S), BG)
    img.paste(Image.new("RGB", (S, S), LEAF), (0, 0), mask)

    bbox = mask.getbbox()
    top, bot = bbox[1], bbox[3]
    d = ImageDraw.Draw(img)

    # 주맥
    d.line([(S / 2, top + S * 0.03), (S / 2, bot - S * 0.02)], fill=VEIN, width=int(S * 0.026))
    # 측맥: 잎 폭에 맞춰 길이를 줄여 밖으로 삐져나가지 않게 한다.
    h = bot - top
    for i in range(5):
        y = top + h * (0.24 + i * 0.145)
        # 해당 y에서의 잎 반폭
        row = mask.crop((0, int(y), S, int(y) + 1)).getbbox()
        if not row:
            continue
        half = (row[2] - row[0]) / 2 * 0.72
        dy = half * 0.62
        d.line([(S / 2, y), (S / 2 - half, y - dy)], fill=VEIN, width=int(S * 0.016))
        d.line([(S / 2, y), (S / 2 + half, y - dy)], fill=VEIN, width=int(S * 0.016))

    return img.resize((size, size), RESAMPLE)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for s in (180, 192, 512):
        p = os.path.join(OUT, f"icon-{s}.png")
        make(s).save(p)
        print("wrote", p, os.path.getsize(p), "bytes")


if __name__ == "__main__":
    main()
