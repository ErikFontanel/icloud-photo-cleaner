"""Synthetic fixture photos with EXIF dates and optional GPS. No real photos."""

import pathlib
import random
import sys
from datetime import datetime, timedelta

import piexif
from PIL import Image, ImageDraw, ImageFilter

out = pathlib.Path(sys.argv[1])
out.mkdir(exist_ok=True)
random.seed(7)


def dms(v):
    v = abs(v)
    d = int(v)
    m = int((v - d) * 60)
    s = round(((v - d) * 60 - m) * 60 * 100)
    return ((d, 1), (m, 1), (s, 100))


def save(img, name, when, gps=None):
    ex = {"0th": {}, "Exif": {piexif.ExifIFD.DateTimeOriginal: when.strftime("%Y:%m:%d %H:%M:%S").encode()}, "GPS": {}}
    if gps:
        lat, lon = gps
        ex["GPS"] = {
            piexif.GPSIFD.GPSLatitudeRef: b"N" if lat >= 0 else b"S",
            piexif.GPSIFD.GPSLatitude: dms(lat),
            piexif.GPSIFD.GPSLongitudeRef: b"E" if lon >= 0 else b"W",
            piexif.GPSIFD.GPSLongitude: dms(lon),
        }
    img.save(out / name, "JPEG", quality=92, exif=piexif.dump(ex))


def scene(seed, w=1600, h=1200):
    r = random.Random(seed)
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    top, bot = [r.randint(0, 255) for _ in range(3)], [r.randint(0, 255) for _ in range(3)]
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bot)))
    for _ in range(25):
        x, y, s = r.randint(0, w), r.randint(0, h), r.randint(40, 300)
        d.ellipse([x, y, x + s, y + s], fill=tuple(r.randint(0, 255) for _ in range(3)))
    return img


LISBON = (38.7223, -9.1393)
t0 = datetime(2024, 6, 14, 10, 0, 0)
# Burst: one scene shifted a few pixels, 1 s apart.
base = scene(100)
for i in range(5):
    save(base.crop((i * 6, i * 4, 1500 + i * 6, 1125 + i * 4)), f"burst_{i}.jpg", t0 + timedelta(seconds=i), LISBON)
# Event: 10 different scenes over one day, only 3 with GPS.
for i in range(10):
    save(scene(200 + i), f"event_{i}.jpg", t0 + timedelta(hours=1, minutes=40 * i), LISBON if i < 3 else None)
# Receipt-like document.
doc = Image.new("RGB", (900, 1600), "white")
d = ImageDraw.Draw(doc)
for y in range(80, 1500, 48):
    d.rectangle([80, y, 80 + random.randint(200, 700), y + 18], fill="black")
save(doc, "receipt.jpg", datetime(2025, 2, 3, 12, 0))
# Blurry shot.
save(scene(300).filter(ImageFilter.GaussianBlur(25)), "blurry.jpg", datetime(2025, 2, 3, 12, 5))
print(len(list(out.glob("*.jpg"))), "fixtures")
