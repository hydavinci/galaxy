#!/usr/bin/env python3
"""Generate LOD binary star files from HYG catalog."""
import csv
import struct
import math
import os
import sys

# Try to find hyg data
HYG_PATH = '/tmp/hyg.csv'
if not os.path.exists(HYG_PATH):
    print("Downloading HYG catalog...")
    os.system('curl -sL "https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/v3/hyg_v38.csv.gz" -o /tmp/hyg.csv.gz && gunzip -f /tmp/hyg.csv.gz')

if not os.path.exists(HYG_PATH):
    # Try alternate URL
    os.system('curl -sL "https://raw.githubusercontent.com/astronexus/HYG-Database/refs/heads/main/hyg/CURRENT/hygdata_v41.csv" -o /tmp/hyg.csv')

if not os.path.exists(HYG_PATH):
    print("ERROR: Cannot find HYG data")
    sys.exit(1)

OUT_DIR = '/home/Galaxy/engine/public/data'
os.makedirs(OUT_DIR, exist_ok=True)

# LOD levels: (mag_min, mag_max, filename)
LEVELS = [
    (-2, 4, 'stars-lod0.bin'),
    (4, 5.5, 'stars-lod1.bin'),
    (5.5, 7, 'stars-lod2.bin'),
    (7, 9, 'stars-lod3.bin'),
    (9, 11, 'stars-lod4.bin'),
]

# Read CSV
stars_by_level = [[] for _ in LEVELS]

with open(HYG_PATH, 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            mag = float(row.get('mag', '99'))
            ra_h = float(row.get('ra', '0'))
            dec_d = float(row.get('dec', '0'))
            bv = float(row.get('ci', '0') or '0')
        except (ValueError, TypeError):
            continue

        if mag > 11:
            continue

        ra_rad = ra_h * math.pi / 12.0
        dec_rad = dec_d * math.pi / 180.0

        for i, (mmin, mmax, _) in enumerate(LEVELS):
            if mmin <= mag < mmax:
                stars_by_level[i].append((ra_rad, dec_rad, mag, bv))
                break

# Write binary files
for i, (mmin, mmax, fname) in enumerate(LEVELS):
    stars = stars_by_level[i]
    path = os.path.join(OUT_DIR, fname)
    with open(path, 'wb') as f:
        for ra, dec, mag, bv in stars:
            f.write(struct.pack('ffff', ra, dec, mag, bv))
    print(f"  {fname}: {len(stars)} stars (mag {mmin} to {mmax})")

total = sum(len(s) for s in stars_by_level)
print(f"\nTotal: {total} stars across {len(LEVELS)} LOD levels")
