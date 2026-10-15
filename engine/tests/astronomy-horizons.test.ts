import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { computeSky, horizontalDirection } from '../src/observer/astronomy';

const evidence = new URL('../../test-data/astronomy/', import.meta.url);
const horizons = JSON.parse(readFileSync(new URL('horizons-fixture.json', evidence), 'utf8'));
const usno = JSON.parse(readFileSync(new URL('usno-phases.json', evidence), 'utf8'));
const D = Math.PI / 180;
function close(actual: number, expected: number, tolerance: number, label: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs reference ${expected}; tolerance ${tolerance}`);
}

test('offline Horizons fixture is independent NASA/JPL data, with preserved source hashes', () => {
  assert.equal(horizons.samples.length, 9);
  assert.equal(horizons.sources.length, 4);
  for (const source of horizons.sources) {
    const raw = readFileSync(new URL(source.file, evidence));
    assert.equal(createHash('sha256').update(raw).digest('hex'), source.sha256);
    assert.match(raw.toString(), /NASA\/JPL Horizons API/);
    assert.match(raw.toString(), /\{source: DE441\}/);
    assert.match(raw.toString(), /Atmos refraction: NO \(AIRLESS\)/);
    assert.match(source.url, /^https:\/\/ssd\.jpl\.nasa\.gov\/api\/horizons\.api\?/);
  }
});

for (const sample of horizons.samples) {
  test(`independent JPL Horizons: ${sample.body} ${sample.date} at Suzhou`, () => {
    const body = computeSky(new Date(sample.date), horizons.site).bodies.find(b => b.id === sample.body)!;
    const reference = horizontalDirection(sample.azimuthDeg, sample.altitudeDeg);
    const difference = Math.hypot(...body.direction.map((v, i) => v - reference[i]));
    const angularSeparationDeg = 2 * Math.asin(Math.min(1, difference / 2)) / D;
    // Fixed preview acceptance bounds, NOT an accuracy guarantee across all dates.
    assert.ok(angularSeparationDeg < 0.02, `position residual ${angularSeparationDeg * 3600} arcsec`);
    close(body.altitudeDeg, sample.altitudeDeg, 0.02, 'airless center altitude');
    close(body.distanceAU / sample.distanceAU, 1, 0.001, 'distance relative ratio');
    close(body.angularDiameterRad / D * 3600 / sample.angularDiameterArcsec, 1, 0.001, 'disk diameter ratio');
    close(body.illuminatedFraction, sample.illuminatedFraction, 0.002, 'topocentric illuminated fraction');
    close(body.magnitude, sample.magnitude, 0.15, 'empirical magnitude');
  });
}

for (const phase of usno.response.phasedata) {
  const target: Record<string, number> = { 'New Moon': 0, 'First Quarter': 90, 'Full Moon': 180, 'Last Quarter': 270 };
  const date = `${phase.year}-${String(phase.month).padStart(2, '0')}-${String(phase.day).padStart(2, '0')}T${phase.time}:00Z`;
  test(`independent USNO phase: ${phase.phase} ${date}`, () => {
    const sky = computeSky(new Date(date), horizons.site);
    const angularError = ((sky.moonPhaseDeg - target[phase.phase] + 540) % 360) - 180;
    close(angularError, 0, 0.03, 'geocentric ecliptic phase longitude');
    const fraction = sky.bodies.find(b => b.id === 'moon')!.illuminatedFraction;
    if (phase.phase === 'New Moon') assert.ok(fraction < 0.001);
    else if (phase.phase === 'Full Moon') assert.ok(fraction > 0.998);
    else close(fraction, 0.5, 0.02, 'topocentric quarter phase (not identically 50%)');
  });
}
