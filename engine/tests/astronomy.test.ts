import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  DEFAULT_LOCATION, LOCATIONS, computeSky, horizontalDirection, refractedAltitude,
  starHorizontal, transformDirection,
} from '../src/observer/astronomy';
import type { CatalogStar, ObserverLocation, Vec3 } from '../src/observer/types';
// CJS reference path avoids astronomy-engine 2.1.19's tsx/ESM package ambiguity.
const A: typeof import('astronomy-engine') = createRequire(import.meta.url)('astronomy-engine');
const D = Math.PI / 180;
function close(actual: number, expected: number, tolerance = 1e-6, label = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected} (tol=${tolerance})`);
}
function vectorClose(actual: Vec3, expected: Vec3, tolerance = 1e-6) {
  actual.forEach((v, i) => close(v, expected[i], tolerance, `component ${i}`));
}
function wrapDifference(a: number, b: number) { return ((a - b + 540) % 360) - 180; }
function bodyAt(date: string, id: string, location = DEFAULT_LOCATION) {
  return computeSky(new Date(date), location).bodies.find(body => body.id === id)!;
}

// These matrix/reference API checks test integration and axis convention; they
// are NOT an independent ephemeris validation (see astronomy-horizons.test.ts).
for (const year of [1900, 2000, 2050, 2100]) {
  test(`column-major J2000 basis gives N/E/S/W/zenith/nadir, including poles (${year})`, () => {
    const date = new Date(`${year}-06-21T12:34:56Z`);
    for (const latitude of [-90, -33.8688, 0, 31.2989, 90]) {
      const location = { ...DEFAULT_LOCATION, latitude };
      const sky = computeSky(date, location);
      const lst = (15 * A.SiderealTime(date) + location.longitude) * D;
      const lat = latitude * D;
      // Independent elementary ENU terrestrial basis in equator-of-date.
      const north: Vec3 = [-Math.sin(lat) * Math.cos(lst), -Math.sin(lat) * Math.sin(lst), Math.cos(lat)];
      const east: Vec3 = [-Math.sin(lst), Math.cos(lst), 0];
      const up: Vec3 = [Math.cos(lat) * Math.cos(lst), Math.cos(lat) * Math.sin(lst), Math.sin(lat)];
      const cases: [Vec3, Vec3][] = [[north, [0, 0, -1]], [east, [1, 0, 0]], [up, [0, 1, 0]],
        [north.map(x => -x) as Vec3, [0, 0, 1]], [east.map(x => -x) as Vec3, [-1, 0, 0]], [up.map(x => -x) as Vec3, [0, -1, 0]]];
      for (const [eqd, expected] of cases) {
        const eqj = A.RotateVector(A.Rotation_EQD_EQJ(date), new A.Vector(...eqd, A.MakeTime(date)));
        vectorClose(transformDirection(sky.equatorialToHorizontal, [eqj.x, eqj.z, eqj.y]), expected, 1e-7);
      }
      const m = sky.equatorialToHorizontal;
      assert.deepEqual([m[3], m[7], m[11], m[12], m[13], m[14], m[15]], [0, 0, 0, 0, 0, 0, 1]);
      const columns: Vec3[] = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
      // RA0/Dec90/RA90 exchanges physical handedness: an orthogonal basis
      // map, not an SO(3) quaternion rotation.
      const determinant = m[0] * (m[5] * m[10] - m[9] * m[6])
        - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
      close(determinant, -1, 1.5e-7);
      columns.forEach(v => close(Math.hypot(...v), 1, 6e-8));
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        close(columns[i].reduce((sum, value, k) => sum + value * columns[j][k], 0), 0, 6e-8);
      }
    }
  });
}

test('horizon helper cardinal signs are north=-Z east=+X', () => {
  vectorClose(horizontalDirection(0, 0), [0, 0, -1]);
  vectorClose(horizontalDirection(90, 0), [1, 0, 0]);
  vectorClose(horizontalDirection(180, 0), [0, 0, 1]);
  vectorClose(horizontalDirection(270, 0), [-1, 0, 0]);
  vectorClose(horizontalDirection(123, 90), [0, 1, 0]);
});

test('J2000 body matrix agrees with separate of-date Horizon path (same-library integration)', () => {
  for (const year of [1900, 2026, 2100]) {
    const date = new Date(`${year}-10-13T11:00:00Z`);
    const sky = computeSky(date, DEFAULT_LOCATION);
    const observer = new A.Observer(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude, DEFAULT_LOCATION.elevation);
    sky.bodies.forEach(body => {
      const id = (body.id[0].toUpperCase() + body.id.slice(1)) as import('astronomy-engine').Body;
      const eqd = A.Equator(id, date, observer, true, true);
      const horizon = A.Horizon(date, observer, eqd.ra, eqd.dec);
      close(wrapDifference(body.azimuthDeg, horizon.azimuth), 0, 5e-6, body.id);
      close(body.altitudeDeg, horizon.altitude, 5e-6, body.id);
      const star: CatalogStar = { ...body };
      vectorClose(starHorizontal(star, sky).direction, body.direction, 1e-7);
    });
  }
});

test('every month has nine finite physical bodies and normalized directions', () => {
  const expected = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
  for (let month = 0; month < 12; month++) {
    const sky = computeSky(new Date(Date.UTC(2026, month, 15, 12)), DEFAULT_LOCATION);
    assert.deepEqual(sky.bodies.map(b => b.id), expected);
    assert.ok(sky.moonPhaseDeg >= 0 && sky.moonPhaseDeg < 360);
    close(sky.sunAltitudeDeg, sky.bodies[0].altitudeDeg);
    for (const body of sky.bodies) {
      for (const [key, value] of Object.entries(body)) if (typeof value === 'number') assert.ok(Number.isFinite(value), key);
      close(Math.hypot(...body.direction), 1, 1e-12);
      close(Math.hypot(...body.sunDirection), 1, 1e-12);
      assert.ok(body.distanceAU > 0 && body.angularDiameterRad > 0 && body.angularDiameterRad < 0.011);
      assert.ok(body.raRad >= 0 && body.raRad < 2 * Math.PI);
      assert.ok(body.azimuthDeg >= 0 && body.azimuthDeg < 360);
      assert.ok(body.illuminatedFraction >= 0 && body.illuminatedFraction <= 1);
      assert.ok(body.apparentAltitudeDeg >= body.altitudeDeg - 1e-10);
      vectorClose(horizontalDirection(body.azimuthDeg, body.altitudeDeg), body.direction, 1e-12);
    }
  }
});

test('star refraction never mutates geometric direction or applies twice', () => {
  const sky = computeSky(new Date('2026-10-13T22:03:30Z'), DEFAULT_LOCATION);
  const star: CatalogStar = { ...sky.bodies[0] };
  const airless = starHorizontal(star, sky);
  const refracted = starHorizontal(star, sky, true);
  assert.deepEqual(airless.direction, refracted.direction);
  assert.equal(airless.altitudeDeg, refracted.altitudeDeg);
  assert.equal(airless.apparentAltitudeDeg, airless.altitudeDeg);
  close(refracted.apparentAltitudeDeg, refractedAltitude(airless.altitudeDeg));
  assert.ok(refracted.apparentAltitudeDeg - airless.altitudeDeg > 0.4);
  const drawn = horizontalDirection(refracted.azimuthDeg, refracted.apparentAltitudeDeg);
  assert.ok(drawn[1] > refracted.direction[1]);
  assert.throws(() => starHorizontal({ ...star, decRad: Math.PI }, sky), RangeError);
  assert.throws(() => starHorizontal({ ...star, raRad: NaN }, sky), RangeError);
});

test('refraction remains bounded at poles and is a standard-atmosphere approximation', () => {
  close(refractedAltitude(0), 0.4830321231, 1e-9);
  close(refractedAltitude(-90), -90, 1e-12);
  close(refractedAltitude(90), 90, 1e-12);
  for (let alt = -90; alt <= 90; alt += 0.5) {
    const apparent = refractedAltitude(alt);
    assert.ok(Number.isFinite(apparent) && apparent >= alt && apparent <= 90);
  }
});

test('angle-distance product encodes actual equatorial radius, not fixed pixel sizes', () => {
  const radii: Record<string, number> = { sun: 695700, moon: 1737.4, mercury: 2439.7, venus: 6051.8, mars: 3396.19,
    jupiter: 71492, saturn: 60268, uranus: 25559, neptune: 24764 };
  for (const date of ['2026-01-03T12:00:00Z', '2026-07-04T12:00:00Z']) {
    for (const body of computeSky(new Date(date), DEFAULT_LOCATION).bodies) {
      close(Math.sin(body.angularDiameterRad / 2) * body.distanceAU * A.KM_PER_AU, radii[body.id], 1e-8);
    }
  }
  const january = bodyAt('2026-01-03T12:00:00Z', 'sun');
  const july = bodyAt('2026-07-04T12:00:00Z', 'sun');
  assert.ok(january.distanceAU < july.distanceAU);
  assert.ok(january.angularDiameterRad > july.angularDiameterRad * 1.03);
  assert.ok(january.magnitude < july.magnitude);
  close((july.magnitude - january.magnitude), 5 * Math.log10(july.distanceAU / january.distanceAU), 1e-5);
});

test('topocentric Moon is not the geocentric Moon and depends on observation site', () => {
  const date = new Date('2026-10-13T11:00:00Z');
  const a = computeSky(date, DEFAULT_LOCATION).bodies.find(b => b.id === 'moon')!;
  const opposite = { ...DEFAULT_LOCATION, latitude: -DEFAULT_LOCATION.latitude, longitude: DEFAULT_LOCATION.longitude - 180 };
  const b = computeSky(date, opposite).bodies.find(b => b.id === 'moon')!;
  assert.ok(Math.abs(a.distanceAU - b.distanceAU) > 1e-6);
  assert.ok(Math.abs(a.decRad - b.decRad) > 0.002 || Math.abs(a.raRad - b.raRad) > 0.002);
  assert.ok(Math.abs(a.illuminatedFraction - b.illuminatedFraction) > 0.0001);
  close(a.angularDiameterRad * a.distanceAU, b.angularDiameterRad * b.distanceAU, 1e-9);
});

test('crescent illumination uses physical target-Sun separation, not unit directions', () => {
  const sky = computeSky(new Date('2026-10-13T11:00:00Z'), DEFAULT_LOCATION);
  const moon = sky.bodies.find(b => b.id === 'moon')!;
  const sun = sky.bodies.find(b => b.id === 'sun')!;
  const incorrect = sun.direction.map((v, i) => v - moon.direction[i]) as Vec3;
  const wrongLength = Math.hypot(...incorrect);
  const wrongFraction = (1 - incorrect.reduce((s, v, i) => s + v / wrongLength * moon.direction[i], 0)) / 2;
  assert.ok(wrongFraction > 0.6, `old unit-difference would give ${wrongFraction}`);
  assert.ok(moon.illuminatedFraction > 0.07 && moon.illuminatedFraction < 0.09);
  const shaderFraction = (1 - moon.sunDirection.reduce((s, v, i) => s + v * moon.direction[i], 0)) / 2;
  // Reported fraction uses physical same-time geometry; display direction uses
  // light-time/aberration. Their tiny distinction is documented, not hidden.
  close(shaderFraction, moon.illuminatedFraction, 1e-4);
  assert.ok(bodyAt('2025-03-20T11:00:00Z', 'venus').illuminatedFraction < 0.02);
});

test('Suzhou sun rises eastward and sets westward across the geometric horizon', () => {
  const dawn = [bodyAt('2026-10-13T21:50:00Z', 'sun'), bodyAt('2026-10-13T22:10:00Z', 'sun')];
  assert.ok(dawn[0].altitudeDeg < 0 && dawn[1].altitudeDeg > 0);
  dawn.forEach(b => assert.ok(b.azimuthDeg > 90 && b.azimuthDeg < 110));
  const dusk = [bodyAt('2026-10-14T09:00:00Z', 'sun'), bodyAt('2026-10-14T10:00:00Z', 'sun')];
  assert.ok(dusk[0].altitudeDeg > 0 && dusk[1].altitudeDeg < 0);
  dusk.forEach(b => assert.ok(b.azimuthDeg > 250 && b.azimuthDeg < 275));
});

test('polar day/night and exact geographic poles remain finite without forced sunrise', () => {
  const tromso = LOCATIONS.find(l => l.name === '特罗姆瑟')!;
  for (let hour = 0; hour < 24; hour += 2) {
    for (const [month, above] of [[5, true], [11, false]] as const) {
      const sky = computeSky(new Date(Date.UTC(2026, month, 21, hour)), tromso);
      assert.equal(sky.sunAltitudeDeg > 0, above);
    }
  }
  for (const latitude of [-90, 90]) {
    const location: ObserverLocation = { ...DEFAULT_LOCATION, latitude, longitude: 0, timezone: 'UTC' };
    for (const month of [5, 11]) {
      const sky = computeSky(new Date(Date.UTC(2026, month, 21, 12)), location);
      assert.equal(sky.sunAltitudeDeg > 0, latitude === 90 ? month === 5 : month === 11);
      sky.bodies.forEach(body => assert.ok(Number.isFinite(body.azimuthDeg + body.altitudeDeg)));
    }
  }
});
