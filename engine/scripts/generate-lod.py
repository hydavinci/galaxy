#!/usr/bin/env python3
"""Regenerate catalog-based LOD0-4 from the retained, pinned HYG v4.1 gzip.

Offline; Python standard library only. --check compares exact bytes without writes.
LOD5-7 procedural density supplements and stars.bin are NOT regenerated here.
HYG-derived catalog data remains CC BY-SA 4.0; see test-data/README.md.
"""
import argparse
import csv
import gzip
import hashlib
import io
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / 'public' / 'data'
HYG_GZ = ROOT.parent / 'test-data' / 'star-catalog' / 'hygdata_v41.csv.gz'
SOURCE_SHA256 = 'd9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd'
SOURCE_BYTES = 33932548
LEVELS = [
    (-2, 4, 'stars-lod0.bin'),
    (4, 5.5, 'stars-lod1.bin'),
    (5.5, 7, 'stars-lod2.bin'),
    (7, 9, 'stars-lod3.bin'),
    (9, 11, 'stars-lod4.bin'),
]


def parse_float(row: dict[str, str], key: str, default: float) -> float:
    value = row.get(key)
    if value in (None, ''):
        return default
    return float(value)


def make_artifacts() -> dict[str, bytes]:
    with gzip.open(HYG_GZ, 'rb') as source:
        data = source.read(SOURCE_BYTES + 1)
    if len(data) != SOURCE_BYTES or hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        raise ValueError('Pinned original HYG source size/hash mismatch')
    stars_by_level: list[list[tuple[float, float, float, float]]] = [[] for _ in LEVELS]
    for row in csv.DictReader(io.StringIO(data.decode('utf-8'))):
        try:
            mag = parse_float(row, 'mag', 99)
            ra_h = parse_float(row, 'ra', 0)
            dec_d = parse_float(row, 'dec', 0)
            bv = parse_float(row, 'ci', 0)
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
    # The shipped binary format is little-endian, independent of host byte order.
    return {name: b''.join(struct.pack('<ffff', *star) for star in stars)
            for (_, _, name), stars in zip(LEVELS, stars_by_level)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Compare existing bytes without writing')
    args = parser.parse_args()
    artifacts = make_artifacts()
    if not args.check:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, data in artifacts.items():
        path = OUT_DIR / name
        if args.check:
            if path.read_bytes() != data:
                raise ValueError(f'{name} differs from the pinned HYG transformation')
        else:
            path.write_bytes(data)
        print(f'{name}: {len(data) // 16:,} stars; {"checked" if args.check else "generated"}')
    print('LOD5-7 and stars.bin unchanged; no network used.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
