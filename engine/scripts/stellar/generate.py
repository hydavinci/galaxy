#!/usr/bin/env python3
"""Offline, deterministic HYG-subset stellar metadata/credits generator.
No download, no original Hipparcos import, no changes to the existing catalog.
Run: python3 scripts/stellar/generate.py [--check]
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[2]
REPOSITORY = ENGINE.parent
FIXTURES = REPOSITORY / 'test-data' / 'stellar-model'
SOURCE = REPOSITORY / 'test-data' / 'star-catalog'
REPORTS = ENGINE / 'test-results' / 'stellar-model'
COMMIT = 'c7f7f883fe678cc7680169a50ccd7dcc49b060ce'
SOURCE_SHA = 'd9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd'
CATALOG_SHA = 'd7ff593765bcbe4a5f30befac1b1d08d520e256212d117c18f156f8177021e47'
SOURCE_URL = f'https://raw.githubusercontent.com/astronexus/HYG-Database/{COMMIT}/hyg/CURRENT/hygdata_v41.csv'
README_URL = f'https://github.com/astronexus/HYG-Database/blob/{COMMIT}/hyg/README.md'
LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
REFERENCES = {
    'hyg': README_URL,
    'scheat': 'http://stars.astro.illinois.edu/sow/scheat.html',
    'sirius': 'https://arxiv.org/html/astro-ph/0306604v1',
    'proxima': 'https://arxiv.org/html/1704.08449',
    'vega': 'https://arxiv.org/html/1211.6055',
    'ballesteros': 'https://arxiv.org/html/1201.1809v2',
    'solarVisual': 'https://arxiv.org/html/1804.07788',
    'solarNominal': 'https://arxiv.org/abs/1510.07674',
}

# Values transcribed from full text live-read on 2026-10-14; names are resolved
# against the pinned original proper-name column, NEVER assumed to equal HIP.
ANCHOR_INPUTS = [
    dict(name='Scheat', expectedId=113521, expectedHip=113881,
         radiusSolar=95, temperatureK=3700, estimatedRadius=False,
         radiusSource='参考：Jim Kaler/UIUC 综述，约95 R☉；变星的代表尺度，非本项目实测',
         temperatureSource='参考：Jim Kaler/UIUC 综述，约3700 K；非实时温度',
         classification='M型巨星/亮巨星（目录分类参考；变星，静态示意）', reference=REFERENCES['scheat']),
    dict(name='Sirius', expectedId=32263, expectedHip=32349,
         radiusSolar=1.711, temperatureK=9900, estimatedRadius=False,
         radiusSource='参考：Kervella 等（2003）干涉角径+视差，1.711±0.013 R☉，天狼星A',
         temperatureSource='参考：Kervella 等（2003）§2.4 采用9900±200 K；非本项目实测',
         classification='天狼星A（文献参考；单球示意，未生成伴星轨道）', reference=REFERENCES['sirius']),
    dict(name='Proxima Centauri', expectedId=70666, expectedHip=70890,
         radiusSolar=0.146, temperatureK=2980, estimatedRadius=False,
         radiusSource='参考：Ribas 等（2017）综合观测约束，0.146±0.007 R☉',
         temperatureSource='参考：Ribas 等（2017），2980±80 K；不模拟耀斑温度变化',
         classification='M型红矮星（文献参考；活动星，静态示意）', reference=REFERENCES['proxima']),
    dict(name='Vega', expectedId=90979, expectedHip=91262,
         radiusSolar=(2.726**2 * 2.418)**(1/3), temperatureK=9360, estimatedRadius=True,
         radiusSource='估算：Monnier 等（2012）表2模型3，赤道2.726/极2.418 R☉的椭球等体积球；未还原扁率',
         temperatureSource='参考：Monnier 等（2012）表2模型3，表面平均9360±90 K；未模拟8910–10070 K纬度差',
         classification='A型快速自转星（文献参考；等体积球估算，非真实扁球）', reference=REFERENCES['vega']),
]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def json_bytes(data, compact=False):
    return (json.dumps(data, ensure_ascii=False, allow_nan=False,
                       separators=(',', ':') if compact else None,
                       indent=None if compact else 2) + '\n').encode('utf8')

def make_artifacts():
    with gzip.open(SOURCE / 'hygdata_v41.csv.gz', 'rb') as source:
        source_bytes = source.read(33932548 + 1)
    assert len(source_bytes) == 33932548, 'Pinned HYG CSV size mismatch'
    catalog_bytes = (ENGINE / 'public/data/space-stars.json').read_bytes()
    assert sha(source_bytes) == SOURCE_SHA, 'Pinned HYG CSV hash mismatch'
    assert sha(catalog_bytes) == CATALOG_SHA, 'Existing catalog changed; do not silently regenerate for another subset'
    license_notice = (SOURCE / 'SOURCE-LICENSE.txt').read_text()
    assert 'Creative Commons Attribution-ShareAlike 4.0 International License' in license_notice
    stars = json.loads(catalog_bytes)['stars']
    assert len(stars) == 9078
    selected_ids = {star['sourceId'] for star in stars}
    assert len(selected_ids) == len(stars)
    original = {r['id']: r for r in csv.DictReader(io.StringIO(source_bytes.decode('utf8'))) if r['id'] in selected_ids}
    rows = []
    for star in sorted(stars, key=lambda s: int(s['sourceId'])):
        row = original[star['sourceId']]
        assert star['id'] == 'hyg-' + row['id']
        assert float(row['absmag']) == star['absoluteMagnitude']
        assert float(row['ci']) == star['bv']
        hip = int(row['hip']) if row['hip'] else None
        assert hip is None or hip > 0
        rows.append([int(row['id']), hip, row['spect'], float(row['ci']), float(row['absmag'])])
    anchors = []
    for params in ANCHOR_INPUTS:
        matched = [r for r in original.values() if r['proper'] == params['name']]
        assert len(matched) == 1, params['name']
        row = matched[0]
        assert int(row['id']) == params['expectedId'] and int(row['hip']) == params['expectedHip']
        anchors.append(dict(id=int(row['id']), **{k: v for k, v in params.items() if not k.startswith('expected')}))
    metadata = dict(schemaVersion=1, sourceCommit=COMMIT, sourceSha256=SOURCE_SHA,
                    catalogSha256=CATALOG_SHA, license='CC-BY-SA-4.0',
                    fields=['hygId', 'hipNumberOrNull', 'rawSpectralType', 'bv', 'absoluteVisualMagnitude'],
                    rows=rows, anchors=anchors)
    metadata_bytes = json_bytes(metadata, compact=True)
    assert len(metadata_bytes) <= 512 * 1024
    limitations = [
        '恒星表面：模型示意，非实拍。照片纹理、自转轴/周期、耀斑、斑点、双星轨道和系外行星均未据此生成。',
        'Reference does not mean a new/direct measurement: literature values may themselves be observation-constrained models, approximations and epoch-dependent estimates.',
        'Only the unchanged 9078-star finite-distance HYG v4.1 subset is modeled; no new catalog rows or distance replacements.',
        'HIP numbers are exact cross-identifiers copied from the already retained HYG source. This is not an import or relicensing of original ESA Hipparcos files.',
        'General temperatures are B-V blackbody-color estimates, not independently measured effective temperatures. No extinction/metallicity/gravity correction.',
        'Radius is a 550 nm monochromatic visual surface-brightness approximation calibrated to the Sun, not full Johnson-V synthetic photometry or a stellar atmosphere fit.',
        'Cool molecular spectra, hot stars, white dwarfs, variables, reddening and unresolved multiple systems can give substantially biased estimates; no per-star uncertainty is inferred.',
        'Ten retained B-V>2 records use the disclosed B-V=2 boundary temperature only for a low-confidence illustrative fallback; it is not a physical measurement.',
        'All luminosities are estimated from the displayed radius and temperature using Stefan-Boltzmann solar ratios, never from HYG lum assumed bolometric.',
        'HYG raw spectral strings are preserved including uncertainty/composite suffixes; these are not corrected or replaced by the model color.',
        'Vega is an explicitly estimated equal-volume sphere from published polar/equatorial radii; gravity darkening and oblateness are not rendered.',
        'Distinct HYG components at the same catalog position keep their exact coordinates; no invented binary separation.',
        'Color is a normalized three-wavelength blackbody display tint with simple gamma compression, not colorimetric RGB or radiometrically calibrated brightness.',
    ]
    credits = dict(schemaVersion=1, title='Stellar close-up parameter model / 恒星近景参数来源',
        attribution='HYG v4.1: David Nash / Astronomy Nexus. New metadata subset and transformations: Galaxy project.',
        sourceLicense='CC-BY-SA-4.0', derivedDataLicense='CC-BY-SA-4.0', licenseUrl=LICENSE_URL,
        sourceLicenseNotice=license_notice,
        source=dict(name='HYG Database', version='4.1', commit=COMMIT, url=SOURCE_URL, readmeUrl=README_URL,
                    sha256=SOURCE_SHA, originalHipparcosImported=False),
        derivative=dict(path='src/space/stellar-metadata.json', sha256=sha(metadata_bytes), bytes=len(metadata_bytes),
                        rows=len(rows), fields=metadata['fields'], embeddedInApp=True, runtimeExtraFetch=False,
                        unchangedCatalogSha256=CATALOG_SHA,
                        modifications='Select existing IDs only; copy hip and spect verbatim, retain numeric ci/absmag for identity checks; add separately sourced four literature anchors.'),
        generator='python3 scripts/stellar/generate.py --check',
        sourceReadDate='2026-10-14', references=REFERENCES, literatureAnchors=anchors,
        solarCalibration=dict(radiusKm=695700, temperatureK=5772, absoluteVisualMagnitude=4.81, wavelengthNm=550),
        model=dict(temperature='T=4600*(1/(0.92*(B-V)+1.7)+1/(0.92*(B-V)+0.62)); Ballesteros 2012 eq.14',
                   radius='R/Rsun=sqrt(10**(0.4*(4.81-Mv))*B_lambda(550nm,5772K)/B_lambda(550nm,T))',
                   bolometricLuminosity='L/Lsun=(R/Rsun)**2*(T/5772K)**4',
                   color='Planck B_lambda samples at 650/550/450nm, divide by channel maximum, apply power 1/2.2; display tint only',
                   ordinaryBvRange=[-0.4, 2.0], retainedFallbackBvRange=[2.0, 2.8], arbitraryRadiusClamp=False),
        limitations=limitations)
    # Verify rather than trusting the CSV label: this field is V-magnitude based.
    visual_errors = [abs(float(r['lum']) / 10**(0.4*(4.85-float(r['absmag']))) - 1)
                     for r in original.values() if r['lum']]
    report = dict(sourceSha256=SOURCE_SHA, catalogSha256=CATALOG_SHA,
        outputRows=len(rows), hipCrossIds=sum(r[1] is not None for r in rows), rawSpectra=sum(bool(r[2]) for r in rows),
        missingSpectra=sum(not r[2] for r in rows),
        outOfOrdinaryBvRange=[dict(id='hyg-'+str(r[0]), hip=r[1], bv=r[3], spectralType=r[2]) for r in rows if not -0.4 <= r[3] <= 2],
        literatureAnchorCount=len(anchors), metadataBytes=len(metadata_bytes), metadataSha256=sha(metadata_bytes),
        hygLumVisualRelationMaxRelativeError=max(visual_errors), hygLumUsed=False,
        additionalCatalogRows=0, originalHipparcosImported=False, runtimeExtraFetch=False)
    return metadata_bytes, json_bytes(credits), json_bytes(report)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate all generated bytes without writing')
    parser.add_argument('--report', action='store_true', help='write generation report to ignored engine/test-results (not with --check)')
    args = parser.parse_args()
    if args.check and args.report:
        parser.error('--check is strictly read-only; do not combine with --report')
    metadata, credits, report = make_artifacts()
    outputs = [(ENGINE / 'src/space/stellar-metadata.json', metadata),
               (ENGINE / 'public/data/stellar-model-credits.json', credits)]
    # Preserve the original scientific report as an immutable expected fixture.
    assert (FIXTURES / 'generation.json').read_bytes() == report, 'Scientific generation report differs'
    for path, expected in outputs:
        if args.check:
            assert path.read_bytes() == expected, f'Generated artifact differs: {path}'
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(expected)
    if args.report:
        REPORTS.mkdir(parents=True, exist_ok=True)
        (REPORTS / 'generation.json').write_bytes(report)
    print(json.dumps(dict(ok=True, check=args.check, files=[str(p.relative_to(REPOSITORY)) for p, _ in outputs],
                          metadataSha256=sha(metadata), metadataBytes=len(metadata))))

if __name__ == '__main__':
    main()
