# Offline scientific test inputs

This is a curated input set, **not a deployment archive or a collection of private QA evidence**. Tests and generators do not download these inputs. All files are regular files. `manifest.json` records the distributed SHA-256/size, original retained snapshot SHA-256/size, and every curation step. A hash establishes byte identity, not a source signature or independent legal clearance.

## HYG v4.1 — CC BY-SA 4.0

Author: **David Nash / Astronomy Nexus**. Archive: <https://github.com/astronexus/HYG-Database>; current project: <https://codeberg.org/astronexus/hyg>.

Pinned archive commit: `c7f7f883fe678cc7680169a50ccd7dcc49b060ce`.

- Original CSV: `hyg/CURRENT/hygdata_v41.csv` at that commit.
- Original size: **33,932,548 bytes**, 119,626 data rows.
- Original SHA-256: `d9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd`.
- Original Git blob SHA-1: `ba2dec4eb0f6768914c7fc1051258100214ddf84`.
- Stored as `star-catalog/hygdata_v41.csv.gz`, **13,537,197 bytes**. Lossless gzip uses compression level 9, mtime 0 and no original filename; it is not a reduced or rounded CSV. The entire numeric catalog does not compress to only a few MB with gzip. Generators read the gzip directly and hash the **decompressed original**, without extracting a working CSV into the checkout.
- `SOURCE-LICENSE.txt`, `hyg-README.md` and `repository-README.md` retain exact upstream bytes, including the epoch/equinox documentation and the archive-migration notice.
- `source-tree-entry.json` contains only the pinned commit, the original API tree's truncation status, and the required CSV blob entry. It is an explicitly curated excerpt, not a claim that this single entry is the complete repository tree. No author profile, commit email, response headers or unrelated GitHub metadata is included.

The HYG source and adapted catalog data are **Creative Commons Attribution-ShareAlike 4.0 International**, <https://creativecommons.org/licenses/by-sa/4.0/>. Preserve attribution, the license link and modification notices, and apply the same license to adaptations. Compression makes no scientific changes. The application's filtering, coordinate conversion, aliases and stellar metadata transformations are described in `engine/public/data/space-stars-credits.json` and `stellar-model-credits.json`. Do not relabel these data MIT or imply endorsement by the source authors.

## JPL Horizons — selected numerical facts, not a blanket content license

Credit: **NASA/JPL Solar System Dynamics, Horizons On-Line Ephemeris System**, <https://ssd.jpl.nasa.gov/horizons/>. Exact query URLs, targets, frames and epochs are in `astronomy/horizons-fixture.json` and `space-world/sources.json`.

- `astronomy/horizons-*.txt`: four airless observer-coordinate tables; nine retained samples for Moon, Sun and Venus.
- `space-world/{earth-helio,moon-geo,neptune-helio}.txt`: three ICRF geometric vector tables; nine samples.
- Each text fixture is the **exact source prefix from `API VERSION` through `$$EOE`**, retaining factual request/header fields and the unchanged table. The three vector files also retain the exact original one-line correction-state legend (`Geometric state vectors have NO corrections or aberrations applied.`), required by the existing test assertion. Tool-generated wrappers/IDs and other nonessential explanatory/contact footer material are not redistributed.
- The `$$SOE`…`$$EOE` block is byte-identical to the original retained response. Its separate SHA-256 is tested. Curated file hashes necessarily differ from wrapper-inclusive originals; both are explicitly recorded. No application-generated ephemeris numbers were substituted into the reference data. Numeric JSON samples are unchanged.

These fixtures are distributed on a **qualified numerical-fact-use basis**, not under MIT, CC BY, or an inferred NASA/JPL permission grant. The [U.S. Copyright Office facts/expression distinction](https://www.copyright.gov/help/faq/faq-protect.html) is the rationale for retaining this narrow factual material. The [SSD FAQ](https://ssd.jpl.nasa.gov/faq.html) says permission is needed to publish information from its site; that statement is **not** a grant of permission. No express JPL/SSD permission was obtained. No source articles, images, logos or full explanatory pages are included. Contractual, compilation/database and non-U.S. rights questions are not resolved by this repository; this is not legal clearance. Keep source acknowledgment and links, and do not imply endorsement.

## USNO lunar phases

`astronomy/usno-phases.json` preserves the original small fixture byte-for-byte: five numerical phase dates/times from the **U.S. Naval Observatory, Astronomical Applications Department** API, <https://aa.usno.navy.mil/api/moon/phases/date?date=2024-04-01&nump=5>. Times are UT with minute resolution. These are factual results from a U.S. government service; U.S. federal-government works are generally not subject to U.S. copyright (17 U.S.C. §105). This is not an attribution of a CC/MIT license or an endorsement. No USNO website prose or images are copied.

## Stellar-model validation and historical source

- `stellar-model/generation.json`: immutable original numerical generation summary. The generator compares it; `--check` never rewrites it or any timestamp.
- `stellar-model/protected-before.json`: exact original preservation hash map. Existing catalog/public files and original types/loader remain checked against it.
- `stellar-model/spacecatalog-generator-original.py`: exact project-authored historical generator whose hash appears in that map. The current executable generator changed **I/O packaging only** to read committed gzip inputs. The old hash is checked against this explicit historical snapshot, not silently updated to the portable script. Current generation is separately checked byte-for-byte against the same public catalog and credits.

HYG-derived facts in the stellar summary retain the HYG attribution/license above. Project-authored scripts and hash manifests follow the project's code terms, not a relicensing of their data inputs. Historical app/shader negative controls are separately documented under `engine/tests/fixtures/historical/`; they are not copies of a complete old engine.

## Excluded material

No private `evidence/`, release trees, backups, browser/tool captures, web-fetch wrappers, request IDs, HTTP headers, GitHub personal profiles/emails, logs or generated verification reports are needed here. Public source URLs and scientific dates are deliberately retained. Optional local output belongs in ignored `engine/test-results/`, never in this immutable fixture directory.
