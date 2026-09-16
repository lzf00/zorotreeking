#!/usr/bin/env python3
"""Render a Xiaohongshu-style day-by-day route film for the Ali Lhasa-return loop."""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path("/Users/liuzf/Documents/Zoro_AI/zorotreeking/scripts/data/ali-lhasa-return-film.json")
CACHE = Path.home() / ".cache" / "ali-film-tiles"
FRAMES = Path("/tmp/ali-loop-film-frames")
OUT_DIR = Path("/Users/liuzf/Desktop")
W, H = 1080, 1440
MAP_TOP, MAP_BOTTOM = 92, 1148
FPS = 24
ZORO_ICON = Path("/Users/liuzf/Documents/Zoro_AI/zorotreeking/scripts/data/zoro-chibi.png")
USER_AGENT = "ZoroTreekingAliFilm/1.0 (personal travel film; local render)"

# Tibet driving box; day 12 flight to Shanghai is kept off the map.
WEST, EAST, SOUTH, NORTH = 79.55, 91.85, 27.95, 32.72
ZOOM = 8
TILE_SIZE = 256

DAY_COLORS = [
    "#6C4DFF",
    "#2F7DFF",
    "#E6A100",
    "#E23B4A",
    "#C23BBE",
    "#0F9D73",
    "#E85D04",
    "#4263EB",
    "#D9480F",
    "#0B7285",
    "#868E96",
    "#495057",
]

LAKES = [
    ("羊湖", 28.97, 90.75, 22, 13),
    ("玛旁雍措", 30.67, 81.48, 16, 12),
    ("色林措", 31.80, 89.00, 18, 12),
    ("纳木措", 30.73, 90.60, 22, 13),
]

LABEL_NUDGE = {
    "gonggar-airport": (10, 16),
    "lhasa": (10, -30),
    "kailash": (10, -32),
    "darchen": (10, 14),
    "zanda": (10, 16),
    "guge": (-78, 6),
    "tholing": (10, -22),
    "ebc": (10, 16),
    "rongbuk": (10, -24),
    "tingri": (10, -20),
    "gawula": (36, 18),
    "tingri": (-72, -28),
    "king-peak": (10, -26),
    "manasarovar": (10, 14),
    "selin": (10, -22),
    "namtso": (10, 14),
}


def mercator_y(lat: float) -> float:
    lat = max(min(lat, 85.05112878), -85.05112878)
    rad = math.radians(lat)
    return math.log(math.tan(math.pi / 4 + rad / 2))


def lnglat_to_px(lng: float, lat: float, box: tuple[int, int, int, int]) -> tuple[int, int]:
    x0, y0, x1, y1 = box
    mx0, mx1 = WEST, EAST
    my0, my1 = mercator_y(SOUTH), mercator_y(NORTH)
    x = x0 + (lng - mx0) / (mx1 - mx0) * (x1 - x0)
    y = y1 - (mercator_y(lat) - my0) / (my1 - my0) * (y1 - y0)
    return int(round(x)), int(round(y))


def tile_xy(lng: float, lat: float, z: int) -> tuple[float, float]:
    n = 2**z
    x = (lng + 180.0) / 360.0 * n
    lat = max(min(lat, 85.05112878), -85.05112878)
    y = (1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def download_tile(z: int, x: int, y: int) -> Image.Image:
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / f"esri-topo-{z}-{x}-{y}.png"
    if not dest.exists():
        url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                dest.write_bytes(resp.read())
        except Exception:
            img = Image.new("RGB", (TILE_SIZE, TILE_SIZE), "#e6ddcc")
            dest.parent.mkdir(parents=True, exist_ok=True)
            img.save(dest)
    img = Image.open(dest).convert("RGB")
    if img.size != (TILE_SIZE, TILE_SIZE):
        img = img.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.LANCZOS)
    return img


def stitch_tiles(box: tuple[int, int, int, int]) -> Image.Image:
    x0, y0, x1, y1 = box
    tx0, ty1 = tile_xy(WEST, SOUTH, ZOOM)
    tx1, ty0 = tile_xy(EAST, NORTH, ZOOM)
    ix0, iy0 = math.floor(tx0), math.floor(ty0)
    ix1, iy1 = math.ceil(tx1) - 1, math.ceil(ty1) - 1
    tile_w = TILE_SIZE
    mosaic_w = (ix1 - ix0 + 1) * tile_w
    mosaic_h = (iy1 - iy0 + 1) * tile_w
    mosaic = Image.new("RGB", (mosaic_w, mosaic_h), "#ddd4c4")
    jobs = [(x, y) for y in range(iy0, iy1 + 1) for x in range(ix0, ix1 + 1)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(download_tile, ZOOM, x, y): (x, y) for x, y in jobs}
        for fut in as_completed(futs):
            x, y = futs[fut]
            tile = fut.result()
            mosaic.paste(tile, ((x - ix0) * tile_w, (y - iy0) * tile_w))
    left = int((tx0 - ix0) * tile_w)
    top = int((ty0 - iy0) * tile_w)
    right = int((tx1 - ix0) * tile_w)
    bottom = int((ty1 - iy0) * tile_w)
    cropped = mosaic.crop((left, top, max(left + 8, right), max(top + 8, bottom)))
    return cropped.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/Supplemental/Songti.ttc",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=0)
            except OSError:
                continue
    return ImageFont.load_default()


def polyline_length(pts: list[tuple[int, int]]) -> float:
    total = 0.0
    for a, b in zip(pts, pts[1:]):
        total += math.hypot(b[0] - a[0], b[1] - a[1])
    return total


def resample(pts: list[tuple[int, int]], t: float) -> tuple[tuple[int, int], float]:
    if len(pts) == 1:
        return pts[0], 0.0
    total = polyline_length(pts)
    if total <= 1:
        return pts[-1], 0.0
    target = max(0.0, min(1.0, t)) * total
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        if acc + seg >= target:
            u = 0 if seg == 0 else (target - acc) / seg
            x = int(a[0] + (b[0] - a[0]) * u)
            y = int(a[1] + (b[1] - a[1]) * u)
            ang = math.atan2(b[1] - a[1], b[0] - a[0])
            return (x, y), ang
        acc += seg
    ang = math.atan2(pts[-1][1] - pts[-2][1], pts[-1][0] - pts[-2][0])
    return pts[-1], ang


def slice_path(pts: list[tuple[int, int]], t: float) -> list[tuple[int, int]]:
    if t <= 0 or len(pts) < 2:
        return pts[:1]
    if t >= 1:
        return pts
    pos, _ = resample(pts, t)
    total = polyline_length(pts)
    target = t * total
    acc = 0.0
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        if acc + seg >= target:
            out.append(pos)
            return out
        out.append(b)
        acc += seg
    return pts


def draw_polyline(img: Image.Image, pts: list[tuple[int, int]], color: str, width: int, fade: float = 1.0) -> None:
    if len(pts) < 2:
        return
    rgb = tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))
    alpha = int(255 * fade)
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.line(pts, fill=(*rgb, alpha), width=width, joint="curve")
    r = max(1, width // 2)
    od.ellipse((pts[0][0] - r, pts[0][1] - r, pts[0][0] + r, pts[0][1] + r), fill=(*rgb, alpha))
    od.ellipse((pts[-1][0] - r, pts[-1][1] - r, pts[-1][0] + r, pts[-1][1] + r), fill=(*rgb, alpha))
    img.alpha_composite(overlay)


def draw_route(img: Image.Image, pts: list[tuple[int, int]], color: str, width: int, fade: float = 1.0) -> None:
    if len(pts) < 2:
        return
    draw_polyline(img, pts, "#FFFFFF", width + 8, min(1.0, fade + 0.15))
    draw_polyline(img, pts, color, width, fade)


def alpha_paste(base: Image.Image, overlay: Image.Image, xy: tuple[int, int]) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(overlay, xy, overlay)
    base.alpha_composite(layer)


_ZORO_CACHE: Image.Image | None = None


def draw_zoro(base: Image.Image, xy: tuple[int, int], _ang: float = 0.0) -> None:
    global _ZORO_CACHE
    if _ZORO_CACHE is None:
        _ZORO_CACHE = Image.open(ZORO_ICON).convert("RGBA").resize((86, 86), Image.Resampling.LANCZOS)
    icon = _ZORO_CACHE
    x, y = xy
    alpha_paste(base, icon, (x - icon.size[0] // 2, y - icon.size[1] // 2 - 6))


def draw_pin(draw: ImageDraw.ImageDraw, xy: tuple[int, int], color: str = "#E23B4A") -> None:
    x, y = xy
    rgb = tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))
    draw.polygon([(x, y + 14), (x - 9, y - 2), (x + 9, y - 2)], fill=(*rgb, 255))
    draw.ellipse((x - 8, y - 18, x + 8, y - 2), fill=(*rgb, 255), outline=(255, 255, 255, 255), width=2)
    draw.ellipse((x - 3, y - 13, x + 3, y - 7), fill=(255, 255, 255, 255))


def pill(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font: ImageFont.FreeTypeFont) -> None:
    x, y = xy
    pad_x, pad_y = 10, 5
    tw = int(font.getlength(text))
    th = 22
    box = (x, y, x + tw + pad_x * 2, y + th + pad_y * 2)
    draw.rounded_rectangle(box, radius=11, fill=(255, 255, 255, 235), outline=(30, 30, 30, 40), width=1)
    draw.text((x + pad_x, y + pad_y - 1), text, font=font, fill=(24, 24, 24, 255))


def wrap(text: str, font: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for ch in text:
        trial = current + ch
        if font.getlength(trial) <= max_w:
            current = trial
        else:
            if current:
                lines.append(current)
            current = ch
    if current:
        lines.append(current)
    return lines or [""]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--poster-only", action="store_true")
    parser.add_argument("--sample-day", type=int, default=0)
    parser.add_argument("--max-frames", type=int, default=0)
    args = parser.parse_args()

    data = json.loads(ROOT.read_text())
    points = {p["id"]: p for p in data["points"]}
    days = data["days"]
    box = (28, MAP_TOP + 8, W - 28, MAP_BOTTOM - 8)

    projected: dict[int, list[tuple[int, int]]] = {}
    for day in days:
        n = day["day"]
        raw = data["geometry"].get(str(n), [])
        pts = []
        for lat, lng in raw:
            if n == 12 and lng > 93:
                continue
            pts.append(lnglat_to_px(lng, lat, box))
        cleaned: list[tuple[int, int]] = []
        for pt in pts:
            if not cleaned or math.hypot(pt[0] - cleaned[-1][0], pt[1] - cleaned[-1][1]) >= 1.5:
                cleaned.append(pt)
        projected[n] = cleaned

    print("stitching basemap tiles…")
    terrain = stitch_tiles(box)
    terrain = terrain.convert("RGBA")
    wash = Image.new("RGBA", terrain.size, (255, 248, 236, 56))
    terrain = Image.alpha_composite(terrain, wash)

    font_title = load_font(36, True)
    font_kicker = load_font(20)
    font_day = load_font(30, True)
    font_body = load_font(26)
    font_small = load_font(22)
    font_label = load_font(20)
    font_peak = load_font(22, True)

    overnight_ids = {
        1: "lhasa",
        2: "shigatse",
        3: "tingri",
        4: "ebc",
        5: "saga",
        6: "darchen",
        7: "shiquanhe",
        8: "dongco",
        9: "baingoin",
        10: "lhasa",
        11: "lhasa",
    }

    def via_text(day: dict) -> str:
        names = []
        for pid in day["pointIds"]:
            pt = points.get(pid)
            if not pt:
                continue
            name = pt["shortName"]
            if name not in names:
                names.append(name)
        return " → ".join(names)

    def paint_labels(img: Image.Image, active_day: int | None, progress: float) -> None:
        d = ImageDraw.Draw(img)
        for name, lat, lng, rx, ry in LAKES:
            x, y = lnglat_to_px(lng, lat, box)
            d.text((x - int(font_label.getlength(name) / 2), y - 8), name, font=font_label, fill=(36, 92, 122, 220))

        always = [
            ("珠峰", "ebc"),
            ("冈仁波齐", "kailash"),
            ("国王峰", "king-peak"),
            ("拉萨", "lhasa"),
            ("狮泉河", "shiquanhe"),
        ]
        for name, pid in always:
            pt = points[pid]
            x, y = lnglat_to_px(pt["lng"], pt["lat"], box)
            dx, dy = LABEL_NUDGE.get(pid, (8, -26))
            d.text((x + dx, y + dy), name, font=font_peak, fill=(40, 28, 18, 235))

        shown = {"珠峰", "冈仁波齐", "国王峰", "拉萨", "狮泉河"}
        if active_day:
            day = next(item for item in days if item["day"] == active_day)
            for pid in day["pointIds"]:
                pt = points.get(pid)
                if not pt or pt["shortName"] in shown:
                    continue
                x, y = lnglat_to_px(pt["lng"], pt["lat"], box)
                draw_pin(d, (x, y))
                dx, dy = LABEL_NUDGE.get(pid, (12, -34))
                pill(d, (x + dx, y + dy), pt["shortName"], font_label)
                shown.add(pt["shortName"])
            hid = overnight_ids.get(active_day)
            if hid and progress > 0.72:
                pt = points[hid]
                x, y = lnglat_to_px(pt["lng"], pt["lat"], box)
                d.ellipse((x - 10, y - 10, x + 10, y + 10), fill=(226, 59, 74, 255), outline=(255, 255, 255, 255), width=3)
        else:
            for hid, label in (
                ("shigatse", "日喀则"),
                ("tingri", "定日"),
                ("saga", "萨嘎"),
                ("darchen", "塔钦"),
                ("zanda", "札达"),
                ("dongco", "洞措"),
                ("baingoin", "班戈"),
            ):
                pt = points[hid]
                x, y = lnglat_to_px(pt["lng"], pt["lat"], box)
                draw_pin(d, (x, y))
                dx, dy = LABEL_NUDGE.get(hid, (12, -34))
                pill(d, (x + dx, y + dy), label, font_label)

    def compose_frame(done_days: list[int], current: int | None, t: float, phase: str) -> Image.Image:
        canvas = Image.new("RGBA", (W, H), (245, 238, 224, 255))
        head = ImageDraw.Draw(canvas)
        head.rectangle((0, 0, W, MAP_TOP), fill=(18, 16, 14, 255))
        head.text((40, 18), "阿里大环线 · 珠峰过夜 2026", font=font_title, fill=(255, 246, 232, 255))
        head.text((40, 60), "拉萨取还 · 09.26–10.07 · 不去吉隆", font=font_kicker, fill=(210, 196, 176, 255))

        map_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        map_layer.paste(terrain, box[:2])
        md = ImageDraw.Draw(map_layer)
        for name, lat, lng, rx, ry in LAKES:
            x, y = lnglat_to_px(lng, lat, box)
            md.ellipse((x - rx, y - ry, x + rx, y + ry), fill=(126, 198, 224, 80), outline=(90, 168, 206, 130), width=2)
        for n in range(1, 11):
            draw_polyline(map_layer, projected.get(n, []), "#C4A484", 6, 0.42)
        for n in done_days:
            draw_route(map_layer, projected.get(n, []), DAY_COLORS[(n - 1) % len(DAY_COLORS)], 9, 0.96)
        car_xy = None
        car_ang = 0.0
        if current:
            pts = projected.get(current, [])
            color = DAY_COLORS[(current - 1) % len(DAY_COLORS)]
            if current >= 11:
                lhasa = lnglat_to_px(points["lhasa"]["lng"], points["lhasa"]["lat"], box)
                r = 16 + int(7 * abs(math.sin(t * math.pi)))
                md.ellipse((lhasa[0] - r, lhasa[1] - r, lhasa[0] + r, lhasa[1] + r), outline=(226, 59, 74, 255), width=4)
                car_xy, car_ang = lhasa, 0.0
            else:
                draw_route(map_layer, slice_path(pts, t), color, 12, 1.0)
                if pts:
                    car_xy, car_ang = resample(pts, t)
        canvas.alpha_composite(map_layer)
        paint_labels(canvas, current if current and current <= 10 else None, t)
        if car_xy:
            draw_zoro(canvas, car_xy, car_ang)

        card_h = H - MAP_BOTTOM
        card = Image.new("RGBA", (W, card_h), (255, 250, 242, 255))
        cd = ImageDraw.Draw(card)
        cd.rectangle((0, 0, W, 7), fill=(226, 59, 74, 255))
        if current:
            day = next(item for item in days if item["day"] == current)
            color = DAY_COLORS[(current - 1) % len(DAY_COLORS)]
            cd.rounded_rectangle((36, 22, 150, 64), radius=14, fill=color)
            cd.text((52, 28), f"D{day['day']:02d}", font=font_day, fill=(255, 255, 255, 255))
            cd.text((168, 28), day["date"], font=font_day, fill=(36, 28, 22, 255))
            y = 76
            for line in wrap(via_text(day), font_body, W - 80)[:2]:
                cd.text((36, y), line, font=font_body, fill=(28, 22, 16, 255))
                y += 34
            cd.text((36, y + 2), f"{day['distance']}  ·  {day['driving']}", font=font_small, fill=(92, 78, 64, 255))
            stay = day["hotel"] or day["overnight"]
            stay_line = f"住宿  {day['city']} · {stay}"
            yy = y + 34
            for line in wrap(stay_line, font_small, W - 80)[:2]:
                cd.text((36, yy), line, font=font_small, fill=(166, 84, 32, 255))
                yy += 28
            highlight = "  ·  ".join(day["highlights"][:4])
            for line in wrap(f"看点  {highlight}", font_small, W - 80)[:1]:
                cd.text((36, yy + 2), line, font=font_small, fill=(92, 78, 64, 255))
            cd.text((36, card_h - 38), f"公路  {day['roads']}", font=font_small, fill=(130, 116, 100, 255))
        else:
            cd.text((36, 28), "全线总览  12 天闭环", font=font_day, fill=(36, 28, 22, 255))
            cd.text((36, 78), "拉萨 → 日喀则 → 定日/珠峰过夜 → 萨嘎 → 塔钦", font=font_body, fill=(36, 28, 22, 255))
            cd.text((36, 116), "土林穿行 → 狮泉河 → 洞措 → 色林措 → 班戈 → 纳木措 → 拉萨", font=font_small, fill=(92, 78, 64, 255))
            cd.text((36, 158), "10.05 回拉萨住宿  ·  10.06 还车缓冲  ·  10.07 飞上海", font=font_small, fill=(92, 78, 64, 255))
            cd.text((36, 200), "札达不过夜  ·  不去吉隆  ·  吉山吉舍看珠峰日落星空", font=font_small, fill=(166, 84, 32, 255))
        shadow = Image.new("RGBA", (W, 18), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sd.rectangle((0, 0, W, 18), fill=(0, 0, 0, 40))
        shadow = shadow.filter(ImageFilter.GaussianBlur(6))
        canvas.alpha_composite(shadow, (0, MAP_BOTTOM - 12))
        canvas.paste(card, (0, MAP_BOTTOM))
        return canvas.convert("RGB")

    if args.poster_only or args.sample_day:
        if args.sample_day:
            done = list(range(1, args.sample_day))
            sample = compose_frame(done, args.sample_day, 1.0, "hold")
            sample_path = OUT_DIR / f"阿里大环线-珠峰过夜-D{args.sample_day:02d}.png"
            sample.save(sample_path, "PNG")
            print("wrote", sample_path)
        if args.poster_only:
            poster = compose_frame(list(range(1, 11)), None, 1.0, "overview")
            poster_path = OUT_DIR / "阿里大环线-珠峰过夜-路线总览.png"
            poster.save(poster_path, "PNG")
            print("wrote", poster_path)
        return

    lengths = {n: max(1.0, polyline_length(projected.get(n, []))) for n in range(1, 11)}
    max_len = max(lengths.values())
    segments: list[tuple[str, int | None, list[int], int, float]] = []
    segments.append(("intro", None, [], int(2.2 * FPS), 1.0))
    done: list[int] = []
    for n in range(1, 11):
        draw_s = 2.4 + 3.2 * (lengths[n] / max_len)
        hold_s = 1.8
        segments.append(("draw", n, list(done), int(draw_s * FPS), 0.0))
        segments.append(("hold", n, list(done), int(hold_s * FPS), 1.0))
        done.append(n)
    segments.append(("hold", 11, list(done), int(2.2 * FPS), 1.0))
    segments.append(("hold", 12, list(done), int(2.4 * FPS), 1.0))
    segments.append(("overview", None, list(done), int(3.6 * FPS), 1.0))

    FRAMES.mkdir(parents=True, exist_ok=True)
    for old in FRAMES.glob("*.jpg"):
        old.unlink()

    idx = 0
    total = sum(s[3] for s in segments)
    if args.max_frames:
        total = min(total, args.max_frames)
    print(f"rendering {total} frames…")
    stop = False
    for phase, current, done_days, count, fixed_t in segments:
        for i in range(count):
            if phase == "draw" and current:
                t = (i + 1) / count
            else:
                t = fixed_t
            frame = compose_frame(done_days, current, t, phase)
            frame.save(FRAMES / f"frame_{idx:05d}.jpg", quality=86)
            idx += 1
            if idx % 40 == 0:
                print(f"  {idx}/{total}")
            if args.max_frames and idx >= args.max_frames:
                stop = True
                break
        if stop:
            break

    still_dir = OUT_DIR / "阿里大环线-珠峰过夜"
    still_dir.mkdir(parents=True, exist_ok=True)
    done_acc: list[int] = []
    for n in range(1, 13):
        still = compose_frame(list(done_acc), n, 1.0, "hold")
        day = next(item for item in days if item["day"] == n)
        still.save(still_dir / f"D{n:02d}-{day['date']}.png", "PNG")
        if n <= 10:
            done_acc.append(n)
    poster = compose_frame(list(range(1, 11)), None, 1.0, "overview")
    poster_path = OUT_DIR / "阿里大环线-珠峰过夜-路线总览.png"
    poster.save(poster_path, "PNG")
    poster.save(still_dir / "00-路线总览.png", "PNG")
    print("wrote", poster_path)

    mp4 = OUT_DIR / "阿里大环线-珠峰过夜-路书动画.mp4"
    cmd = [
        "ffmpeg",
        "-y",
        "-framerate",
        str(FPS),
        "-i",
        str(FRAMES / "frame_%05d.jpg"),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "18",
        "-movflags",
        "+faststart",
        str(mp4),
    ]
    print("encoding", mp4)
    subprocess.run(cmd, check=True)
    print("wrote", poster_path)
    print("wrote", mp4, "frames", idx)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAILED", exc, file=sys.stderr)
        raise
