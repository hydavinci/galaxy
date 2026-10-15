#!/usr/bin/env python3
"""Reproducible HYG 4.1 finite-distance subset (Python standard library only).

From engine/: python3 scripts/spacecatalog/generate.py [--download] [--check]
Inputs live in repository test-data/star-catalog; no network is needed for tests.
Optional --download restores missing pinned inputs to ignored engine/test-results only.
--check is offline/read-only. Optional reports go to ignored engine/test-results.
The derived catalog is CC BY-SA 4.0; this script is not the astronomical source.
"""
from __future__ import annotations

import argparse
import collections
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import urllib.request

ENGINE = Path(__file__).resolve().parents[2]
FIXTURES = ENGINE.parent / 'test-data' / 'star-catalog'
CACHE = ENGINE / 'test-results' / 'star-catalog'
PUBLIC = ENGINE / 'public' / 'data'
COMMIT = 'c7f7f883fe678cc7680169a50ccd7dcc49b060ce'
RAW_ROOT = f'https://raw.githubusercontent.com/astronexus/HYG-Database/{COMMIT}/'
SOURCE_PATH = 'hyg/CURRENT/hygdata_v41.csv'
SOURCE_URL = RAW_ROOT + SOURCE_PATH
SOURCE_SHA256 = 'd9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd'
SOURCE_GIT_BLOB = 'ba2dec4eb0f6768914c7fc1051258100214ddf84'
SOURCE_BYTES = 33932548
LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
LICENSE_ID = 'CC-BY-SA-4.0'
PARSEC_AU = 206264.80624709636
MAX_DOWNLOAD_BYTES = 60000000
MAX_RECORDS = 10000
EXPECTED_RECORDS = 9078
# Keep named nearby systems and a useful bright outer shell without arbitrary
# truncation. Missing B-V / magnitudes are excluded, not imputed.
SELECTION = '(0 < dist <= 50 pc AND mag <= 12) OR (50 < dist <= 100 pc AND mag <= 6.5)'
REQUIRED_KEYS = ('ra', 'dec', 'dist', 'mag', 'absmag', 'ci')
NAME_ZH = {
    '32263': '天狼星', '70666': '比邻星',
    '71456': '南门二A（半人马座α A）', '71453': '南门二B（半人马座α B）',
    '90979': '织女星', '97338': '牛郎星', '69451': '大角星',
    '37173': '南河三', '21368': '毕宿五', '24549': '五车二',
    '113008': '北落师门', '87665': '巴纳德星',
}
KNOWN_IDS = ('32263', '70666', '71453', '71456')
# The source assigns these distinct, documented multiple-system components the
# same RA, Dec and distance. Retain identities; do not invent orbital offsets.
EXPECTED_DUPLICATE_GROUPS = [['hyg-118281', 'hyg-118282']]
FILES = {
    'hygdata_v41.csv': (SOURCE_PATH, SOURCE_SHA256),
    'SOURCE-LICENSE.txt': ('hyg/CURRENT/LICENSE', 'f404190403d31e0ce7223f4cb7af954485ad88077358330754dc5c892a856627'),
    'hyg-README.md': ('hyg/README.md', '81f765951e60131e49ccc91376815791e130ad1db46047eb1384d3ba6bcb5af4'),
    'repository-README.md': ('README.md', '80982fcefb899a3d55fab15e84483ce78fb1e2499906a95fc59c4e517844606e'),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encode(value: object, pretty: bool = False) -> bytes:
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       indent=2 if pretty else None,
                       separators=None if pretty else (',', ':')) + '\n').encode('utf-8')


def input_bytes(filename: str) -> bytes:
    """Read the retained gzip directly; hashes always cover the original CSV."""
    name = filename + '.gz' if filename.endswith('.csv') else filename
    path = FIXTURES / name
    if not path.exists():
        path = CACHE / name
    if filename.endswith('.csv'):
        with gzip.open(path, 'rb') as stream:
            data = stream.read(MAX_DOWNLOAD_BYTES + 1)
    else:
        data = path.read_bytes()
    if len(data) > MAX_DOWNLOAD_BYTES:
        raise ValueError(f'Input exceeds 60 MB ceiling: {filename}')
    return data


def verified_inputs(download: bool = False) -> bytes:
    """Pin the decompressed bytes and the corresponding redistribution notice."""
    for filename, (source_path, expected_hash) in FILES.items():
        try:
            data = input_bytes(filename)
        except FileNotFoundError:
            if not download:
                raise ValueError(f'Missing pinned fixture {filename}; restore test-data or explicitly use --download')
            request = urllib.request.Request(RAW_ROOT + source_path,
                                             headers={'User-Agent': 'Galaxy-HYG-catalog/1'})
            chunks, size = [], 0
            # One request at a time. No silent retries or alternate sources.
            with urllib.request.urlopen(request, timeout=60) as response:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_DOWNLOAD_BYTES:
                        raise ValueError('Source exceeds 60 MB download ceiling')
                    chunks.append(chunk)
            data = b''.join(chunks)
            if sha256(data) != expected_hash:
                raise ValueError(f'Hash mismatch for fetched {filename}; nothing published')
            CACHE.mkdir(parents=True, exist_ok=True)
            if filename.endswith('.csv'):
                with (CACHE / (filename + '.gz')).open('wb') as target:
                    with gzip.GzipFile(fileobj=target, filename='', mode='wb', mtime=0) as stream:
                        stream.write(data)
            else:
                (CACHE / filename).write_bytes(data)
        if sha256(data) != expected_hash:
            raise ValueError(f'Untrusted input {filename}; nothing published')
    source = input_bytes('hygdata_v41.csv')
    if len(source) != SOURCE_BYTES:
        raise ValueError('Unexpected source length')
    git_hash = hashlib.sha1(f'blob {len(source)}\0'.encode() + source).hexdigest()
    if git_hash != SOURCE_GIT_BLOB:
        raise ValueError('Source differs from the pinned official Git tree blob')
    license_text = input_bytes('SOURCE-LICENSE.txt').decode('utf-8')
    if 'Creative Commons Attribution-ShareAlike 4.0 International License' not in license_text:
        raise ValueError('Redistribution license not verified')
    return source


def validated_row(row: dict[str, str]) -> tuple[dict | None, str | None]:
    """Return a usable source record or a disjoint, reproducible rejection reason."""
    if row.get('id') == '0' or row.get('proper', '').strip().lower() in {'sol', 'sun'}:
        return None, 'sun_already_in_solar_system'
    try:
        source_id = str(int(row['id']))
        values = {key: float(row[key]) for key in REQUIRED_KEYS}
    except (KeyError, ValueError, TypeError):
        return None, 'missing_or_invalid_required_field'
    if int(source_id) <= 0:
        return None, 'invalid_source_id'
    if not all(math.isfinite(value) for value in values.values()):
        return None, 'nonfinite_required_field'
    if values['dist'] <= 0 or values['dist'] >= 99999:
        return None, 'unknown_or_nonpositive_distance'
    if not (0 <= values['ra'] < 24 and -90 <= values['dec'] <= 90):
        return None, 'out_of_range_equatorial_angle'
    if not (values['dist'] <= 50 and values['mag'] <= 12 or
            values['dist'] <= 100 and values['mag'] <= 6.5):
        return None, 'outside_selected_volume_or_magnitude'
    return {'sourceId': source_id, **values}, None


def position_au(ra_hours: float, dec_degrees: float, distance_pc: float) -> list[float]:
    """Documented source RA(hours)/Dec(deg) -> EQJ [x,z,y], using float64."""
    alpha, delta = ra_hours * math.pi / 12, dec_degrees * math.pi / 180
    radius = distance_pc * PARSEC_AU
    return [radius * math.cos(delta) * math.cos(alpha),
            radius * math.sin(delta),
            radius * math.cos(delta) * math.sin(alpha)]


def default_name(row: dict[str, str]) -> str:
    if row['proper'].strip():
        return row['proper'].strip()
    if row['hip'].strip():
        return f"HIP {int(row['hip'])}"
    if row['gl'].strip():
        return row['gl'].strip()
    if row['hd'].strip():
        return f"HD {int(row['hd'])}"
    if row['bf'].strip():
        return row['bf'].strip()
    return f"HYG {row['id']}"


def angle_degrees(a: list[float], b: list[float]) -> float:
    cross = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
    return math.degrees(math.atan2(math.hypot(*cross), sum(x*y for x, y in zip(a, b))))


def make_artifacts(source: bytes) -> tuple[bytes, bytes, dict]:
    rows = list(csv.DictReader(io.StringIO(source.decode('utf-8'))))
    stars, selected_rows, exclusions = [], {}, collections.Counter()
    for row in rows:
        values, reason = validated_row(row)
        if values is None:
            exclusions[reason] += 1
            continue
        source_id = values['sourceId']
        if source_id in selected_rows:
            raise ValueError(f'Duplicate source ID {source_id}')
        star = {
            'id': f'hyg-{source_id}', 'name': default_name(row),
            'positionAU': position_au(values['ra'], values['dec'], values['dist']),
            'absoluteMagnitude': values['absmag'], 'bv': values['ci'],
            'distancePc': values['dist'], 'sourceId': source_id,
        }
        if source_id in NAME_ZH:
            star['nameZh'] = NAME_ZH[source_id]
        stars.append(star)
        selected_rows[source_id] = row
    stars.sort(key=lambda star: int(star['sourceId']))
    if len(stars) != EXPECTED_RECORDS or len(stars) > MAX_RECORDS:
        raise ValueError('Pinned selection changed; inspect instead of silent truncation')
    if not all(source_id in selected_rows for source_id in KNOWN_IDS):
        raise ValueError('Required nearest/bright stars missing')
    position_groups = collections.defaultdict(list)
    for star in stars:
        position_groups[tuple(star['positionAU'])].append(star['id'])
    duplicate_groups = sorted(sorted(ids) for ids in position_groups.values() if len(ids) > 1)
    if duplicate_groups != EXPECTED_DUPLICATE_GROUPS:
        raise ValueError(f'Unreviewed exact-position duplicates: {duplicate_groups}')
    dupes = [{
        'ids': group, 'system': 'Gl 166 / 40 Eridani (Keid) B and C',
        'sourceComponents': [selected_rows[star_id[4:]]['comp'] for star_id in group],
        'sourcePrimaryId': selected_rows[group[0][4:]]['comp_primary'],
        'reason': 'Distinct catalog multiple-system components share published RA/Dec/distance. Kept intentionally without fabricated separations or binary orbits.'
    } for group in duplicate_groups]
    angle_disagreements = []
    for source_id, row in selected_rows.items():
        # RA/Dec are the documented authoritative fields; the redundant radian
        # and Cartesian fields are not silently blended into a different position.
        dra = abs(float(row['rarad']) - float(row['ra']) * math.pi / 12) * PARSEC_AU
        ddec = abs(float(row['decrad']) - float(row['dec']) * math.pi / 180) * PARSEC_AU
        if max(dra, ddec) > 0.1:
            angle_disagreements.append({'sourceId': source_id, 'raDifferenceArcsec': dra,
                                        'decDifferenceArcsec': ddec,
                                        'used': 'documented ra hours and dec degrees; no invented correction'})
    bounds = {
        field: {'min': min(star[field] for star in stars), 'max': max(star[field] for star in stars)}
        for field in ('distancePc', 'absoluteMagnitude', 'bv')
    }
    bounds['sourceApparentMagnitude'] = {
        'min': min(float(row['mag']) for row in selected_rows.values()),
        'max': max(float(row['mag']) for row in selected_rows.values())}
    bounds['positionAU'] = {
        'min': [min(star['positionAU'][i] for star in stars) for i in range(3)],
        'max': [max(star['positionAU'][i] for star in stars) for i in range(3)],
    }
    caveats = [
        'A selected nearby-star sample, not a complete census of nearby stars, the Milky Way, or the universe.',
        'HYG compiles historical distance/parallax estimates with heterogeneous quality. Finite distances do not imply precise or certainly measured positions; per-star uncertainty is not available in this derived schema.',
        'Fixed epoch and equinox J2000.0. No proper-motion, radial-velocity, stellar-orbit or perspective evolution is applied. Solar-system time changes do not update these star positions.',
        'Positions are Solar-neighborhood, approximately heliocentric catalog coordinates. No extra barycentric correction is invented; the catalog does not support Solar-system ephemeris-level stellar astrometry.',
        'Magnitude and B-V describe catalog photometry, not resolved photos or measured stellar surface detail; no stellar radii, surface maps or planets are invented.',
        'Binary components may share an estimated distance or exactly the same position at catalog precision. They are not resolved orbital solutions; Alpha Centauri A/B orbital dynamics are not modeled.',
        'RA/Dec decimal source fields are parsed as float64; output precision is computational, not a claim of extra observational accuracy. Radian/Cartesian source fields are not mixed in; one redundant declination conflict is recorded.',
    ]
    catalog = {
        'name': 'HYG Database — nearby finite-distance subset', 'version': '4.1',
        'url': SOURCE_URL, 'sha256': SOURCE_SHA256, 'license': LICENSE_ID,
        'sourceLicense': LICENSE_ID, 'derivedDataLicense': LICENSE_ID,
        'licenseUrl': LICENSE_URL, 'epoch': 'J2000.0 (epoch and equinox)',
        'author': 'David Nash / Astronomy Nexus', 'commit': COMMIT,
        'currentProjectUrl': 'https://codeberg.org/astronexus/hyg',
        'attribution': 'Derived from HYG Database v4.1 by David Nash / Astronomy Nexus, licensed CC BY-SA 4.0. Filtered and converted for Galaxy Space Explorer.',
        'creditsUrl': './data/space-stars-credits.json',
        'limits': {
            'selection': SELECTION, 'nearbyMaxDistancePc': 50, 'nearbyMaxApparentMagnitude': 12,
            'brightShellMaxDistancePc': 100, 'brightShellMaxApparentMagnitude': 6.5,
            'maxRecords': MAX_RECORDS, 'recordCount': len(stars), 'sourceRecordCount': len(rows),
            'unknownDistanceRejectedAtOrAbovePc': 99999,
            'requiredFiniteSourceFields': list(REQUIRED_KEYS), 'sunExcluded': True,
            'truncated': False, 'actualBounds': bounds,
            'exactPositionDuplicateGroups': dupes,
            'redundantCoordinateDisagreements': angle_disagreements,
            'caveats': caveats,
        },
    }
    payload = encode({'schemaVersion': 1, 'frame': 'J2000 EQJ Y-up', 'units': 'AU',
                      'catalog': catalog, 'stars': stars})
    license_text = input_bytes('SOURCE-LICENSE.txt').decode('utf-8')
    credits = {
        'schemaVersion': 1, 'asset': 'space-stars.json',
        'assetSha256': sha256(payload), 'assetBytes': len(payload),
        'source': {'name': 'HYG Database', 'version': '4.1', 'author': 'David Nash / Astronomy Nexus',
                   'archiveRepositoryUrl': 'https://github.com/astronexus/HYG-Database',
                   'currentProjectUrl': 'https://codeberg.org/astronexus/hyg',
                   'url': SOURCE_URL, 'commit': COMMIT, 'gitBlobSha1': SOURCE_GIT_BLOB,
                   'sha256': SOURCE_SHA256, 'bytes': SOURCE_BYTES,
                   'documentationUrl': RAW_ROOT + 'hyg/README.md',
                   'licenseSourceUrl': RAW_ROOT + 'hyg/CURRENT/LICENSE',
                   'licenseSha256': FILES['SOURCE-LICENSE.txt'][1]},
        'sourceLicense': LICENSE_ID, 'derivedDataLicense': LICENSE_ID, 'licenseUrl': LICENSE_URL,
        'sourceLicenseNotice': license_text,
        'attribution': catalog['attribution'],
        'redistribution': 'Credit David Nash / Astronomy Nexus; retain source, license link and change notice. Redistribute this adapted data under CC BY-SA 4.0 with no additional legal/technical restrictions. No endorsement is implied.',
        'changes': [
            'Selected finite non-Solar records under the documented distance/magnitude limits; excluded missing or invalid B-V/absolute-magnitude/RA/Dec values without imputation.',
            'Converted published ra(hours), dec(degrees), dist(pc) using float64 into [d*cos(dec)*cos(ra), d*sin(dec), d*cos(dec)*sin(ra)] * 206264.80624709636 AU.',
            'Kept catalog absolute magnitudes and B-V; added HYG-prefixed stable IDs, fallback names and twelve common Chinese display aliases.',
            'Retained documented Gl 166 B/C identical catalog coordinates without fabricated binary separation; reported redundant-coordinate discrepancy for HYG 119616.',
        ],
        'epoch': catalog['epoch'], 'frame': 'J2000 EQJ Y-up', 'units': 'AU',
        'recordCount': len(stars), 'selection': SELECTION,
        'exactPositionDuplicateGroups': dupes,
        'redundantCoordinateDisagreements': angle_disagreements,
        'limitations': caveats,
        'reproduce': 'python3 scripts/spacecatalog/generate.py --download; python3 scripts/spacecatalog/generate.py --check',
    }
    credits_data = encode(credits, pretty=True)
    star_by_id = {star['sourceId']: star for star in stars}
    known = []
    for source_id in KNOWN_IDS:
        star, row = star_by_id[source_id], selected_rows[source_id]
        known.append({**star, 'sourceRaHours': row['ra'], 'sourceDecDegrees': row['dec'],
                      'sourceDistancePc': row['dist'], 'sourceApparentMagnitude': row['mag'],
                      'reconstructedMagnitude': star['absoluteMagnitude'] + 5*math.log10(star['distancePc'])-5})
    parallax = []
    baseline = [10000.0, 0.0, 0.0]
    for source_id in ('70666', '71456', '32263'):
        star = star_by_id[source_id]
        p = star['positionAU']
        shifted = [p[i]-baseline[i] for i in range(3)]
        shift_one_au = [p[0]-1, p[1], p[2]]
        parallax.append({**star, 'camera0AU': [0, 0, 0], 'camera1AU': baseline,
                         'angularShiftDegrees': angle_degrees(p, shifted),
                         'oneAUAngularShiftArcsec': angle_degrees(p, shift_one_au)*3600,
                         'catalogImpliedParallaxArcsec': 1/star['distancePc'],
                         'interpretation': 'Geometric translation fixture, not a new parallax observation or rendered-pixel proof.'})
    report = {
        'schemaVersion': 1, 'sourceRows': len(rows), 'outputRows': len(stars),
        'selection': SELECTION, 'exclusions': dict(sorted(exclusions.items())),
        'actualBounds': bounds, 'sunCount': 0, 'uniqueIdCount': len(stars),
        'uniquePositionCount': len(position_groups), 'exactPositionDuplicateGroups': dupes,
        'redundantCoordinateDisagreements': angle_disagreements,
        'maxDistanceReconstructionErrorPc': max(abs(math.hypot(*s['positionAU'])/PARSEC_AU-s['distancePc']) for s in stars),
        'sourceSha256': SOURCE_SHA256, 'sourceGitBlobSha1': SOURCE_GIT_BLOB,
        'assets': {
            'space-stars.json': {'bytes': len(payload), 'gzipBytes': len(gzip.compress(payload, mtime=0)), 'sha256': sha256(payload)},
            'space-stars-credits.json': {'bytes': len(credits_data), 'gzipBytes': len(gzip.compress(credits_data, mtime=0)), 'sha256': sha256(credits_data)},
        },
        'knownStars': known, 'nativeParallaxFixtures': parallax,
        'note': 'Native/bundle rendering belongs to the renderer verification; this report proves catalog math and provenance only.',
    }
    return payload, credits_data, report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true', help='restore missing pinned inputs to ignored engine/test-results serially')
    parser.add_argument('--check', action='store_true', help='compare exact generated bytes; do not change public assets')
    parser.add_argument('--report', action='store_true', help='write validation report to ignored engine/test-results (not with --check)')
    args = parser.parse_args()
    if args.check and (args.download or args.report):
        parser.error('--check is strictly offline/read-only; do not combine with --download or --report')
    source = verified_inputs(args.download)
    catalog, credits, report = make_artifacts(source)
    artifacts = {'space-stars.json': catalog, 'space-stars-credits.json': credits}
    for name, data in artifacts.items():
        target = PUBLIC / name
        if args.check:
            if not target.exists() or target.read_bytes() != data:
                raise ValueError(f'{name} differs from reproducible source transformation')
        else:
            PUBLIC.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    report['reproductionMode'] = 'checked' if args.check else 'generated'
    if args.report:
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / 'validation.json').write_bytes(encode(report, pretty=True))
    print(json.dumps({'result': 'PASS', 'mode': report['reproductionMode'],
                      'count': report['outputRows'], 'assets': report['assets']}, indent=2))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError) as error:
        print(f'BLOCKED: {error}', file=sys.stderr)
        sys.exit(1)
