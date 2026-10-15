# Data, observations and attribution

The MIT application-code designation does **not** relicense third-party data, images, textures or reference fixtures. Preserve the individual notices below and in the shipped JSON. Source hosting alone is not proof of a blanket redistribution license or institutional endorsement.

## Active stellar catalog and parameter models

- Source: **HYG Database v4.1**, David Nash / Astronomy Nexus.
- Source/derived-data license: **CC BY-SA 4.0**. Attribution, pinned source commit, original CSV hash, transformations and selection bounds are in [`space-stars-credits.json`](../engine/public/data/space-stars-credits.json).
- The current finite-distance subset contains **9,078 stars**. Invalid/unknown-distance entries are excluded. Exact co-located records and source-coordinate discrepancies are documented rather than silently resolved by inventing positions.
- Existing HIP cross-identifiers come from HYG; this is not a direct import of the original ESA Hipparcos data product.
- Stellar temperatures/radii/luminosities mix referenced values with explicitly labeled estimates. See [`stellar-model-credits.json`](../engine/public/data/stellar-model-credits.json). Smooth stellar close-ups are size/color illustrations, not resolved surface photographs.
- Curated reproducibility inputs have their own notice in the test-data directory. Generated public files must still match the pinned source/transform hashes when packaging paths change.

## Solar System positions

The active scene uses Astronomy Engine 2.1.19, not the earlier approximate Keplerian-only viewer. Coordinates are instantaneous geometric heliocentric J2000-equatorial-derived vectors, with an explicit Y/Z permutation and positions in AU. The Moon is the Earth's heliocentric vector plus a geocentric lunar vector. No observer light-time/refraction or mission-grade N-body propagation is claimed.

The application uses reference radii and simplified rendered spheres. Atmospheric glow, exposure, light and Saturn's neutral ring geometry are visualization approximations. Literature references and coordinate/frame conventions are not a claim of professional astrometric accuracy over the entire 1900–2100 scene range.

## Observation gallery and globe maps

Authoritative inventory: [`observation-gallery-credits.json`](../engine/public/data/observation-gallery-credits.json), plus [`observations/maps/CREDITS.json`](../engine/public/observations/maps/CREDITS.json) and [`observations/photos/credits.json`](../engine/public/observations/photos/credits.json).

- **23 observation-image records** for the existing ten Solar objects; Earth and Moon additionally have separately typed global-map records. There are **27 JPEG files**, counting the 2K/4K map tiers.
- The Earth map is a fixed August 2004 NASA MODIS/Blue Marble composite; source uniform-ocean coloring and other processing are disclosed. It is not live cloud/weather data.
- The Moon visualization uses LRO WAC coverage, polar albedo substitution and documented source repairs. It is not a completely unprocessed global photograph or measured 3D terrain.
- Regional photos, gray-scale images, radar, infrared representative color, enhanced color and mosaics are labeled. The original observation date is distinct from publication date; an unknown capture date stays unknown.
- No local generative fill, fictional stellar granulation or fabricated surface map is substituted for unavailable observations. Gallery images are displayed separately and are not wrapped around spheres as false global maps.
- **MESSENGER images have mission-specific noncommercial educational/public-information conditions**, full NASA/JHUAPL/Carnegie credit and no-endorsement requirements. Do not replace those notices with generic “NASA public domain.”
- SDO, Cassini/CICLOPS and Webb products retain their per-item mission/institution/processor credits and limitations. Check the exact image record before reuse beyond this factual display.

## Photographic background and historical illustration assets

The active distant background streams **Mellinger RGB HiPS through CDS**. It is a two-dimensional sky survey from the Solar neighborhood, not local geometry after interstellar travel. Original source terms apply to that external imagery; it is not covered by the application license.

`public/textures/` and `public/textures/detail/` include historical **Solar System Scope / INOVE** visualization products with **CC BY 4.0** attribution. See their [`CREDITS.txt`](../engine/public/textures/detail/CREDITS.txt), [`credits.json`](../engine/public/textures/detail/credits.json) and [`earth-credits.json`](../engine/public/textures/detail/earth-credits.json). They may use enhanced color or gap-filled/fictional detail. They are preserved for compatibility/regressions, not the current observation-first globe fallback. Earlier procedural binary star supplements likewise are not the active finite-distance star catalog.

## Spacecraft facts and bounded positions

- Mission facts: [`spacecraft-info.json`](../engine/public/data/spacecraft-info.json), twelve original Chinese summaries linked to official NASA/JPL/ESA/CNSA mission pages. No new mission logos or photos are included. Dates, representative instruments and achievements are historical facts, not a status telemetry feed.
- Positions: [`spacecraft-trajectories.json`](../engine/public/data/spacecraft-trajectories.json), nine sampled ephemerides and three historical sites. The dataset is a fixed **2026-10-15** capture, **931,476 bytes**, SHA-256 `47a630f45fd60cd77f0013acae39d842cc207cfc29555fd7f9ae3ab4f22aa8c2`.
- Numeric vectors: **NASA/JPL Solar System Dynamics — Horizons On-Line Ephemeris System**, with individual mission-navigation/FDF/JSpOC solution descriptions. Source-target and body-center IDs, geometric ICRF frame, UTC epochs, AU/AU-per-second conversion and axis permutation accompany the data.
- There are **6,109 source knots**. Interpolation was compared at **18,300 non-knot source epochs**; those are not independent spacecraft observations. Refined Juno knots and validation epochs can come from one finer official grid. The largest measured interpolation residual is approximately **1.383 km for Juno**, not a bound on the craft's true position error or the drawn polyline chord error.
- Seven records are official predictions, Cassini is a historical reconstruction, and Hubble is a short-window TLE-derived model. No extrapolation beyond the stored interval, artificial orbit closure or silent endpoint loop is performed.
- Scene positions add the current application's host-body location to center-relative vectors. The displayed path is a source-knot polyline translated with the current center, not all historical heliocentric coordinates. Marker size and camera framing are not spacecraft dimensions.

Historical-site sources and caveats:

1. **Perseverance:** NASA/JPL's original zero-motion waypoint, not the latest rover waypoint. The date is a date-level historical anchor.
2. **Tianwen-1 / Zhurong:** Wan et al., *Visual Localization of the Tianwen-1 Lander Using Orbital, Descent and Rover Images*, [DOI 10.3390/rs13173439](https://doi.org/10.3390/rs13173439), **CC BY 4.0**. The landing coordinate belongs to the lander/rover site, not the orbiter. An explicitly unofficial Horizons trajectory was not substituted for official mission navigation.
3. **Chang'e 6:** NASA-linked LROC localization, [First Look: Chang'e 6](https://www.lroc.asu.edu/images/1374). The dataset's 2024-06-07 anchor is the observation date, **not the landing instant**. The location does not describe the return capsule or ascent stage today.

Site height zero is only placement on the application's reference sphere, not measured zero elevation. Source latitude/terrain precision limits remain in the records.

### Numerical-source reuse qualification

The [SSD FAQ](https://ssd.jpl.nasa.gov/faq.html) asks **“Do I need permission?”** and answers **“The short answer is yes.”** That is a request for permission, **not a license grant**. The application does not claim express NASA/JPL permission, endorsement, blanket public-domain status or complete legal clearance.

The limited rationale here is the use of factual/model-output numbers, independently selected bounded dates/targets, numerical transformations and original explanatory text—not copying source articles, imagery, logos, software or expressive site layout. The [U.S. Copyright Office](https://www.copyright.gov/help/faq/faq-protect.html) distinguishes facts from their protected expression. This distinction does not itself resolve all contractual, compilation/database or non-U.S. rights. Preserve source links, attribution, dates and these qualifications; review the exact terms before repurposing the dataset. The original private acquisition/review records are not published as a grant of rights.
