import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOCATION, LOCATIONS, computeSky, formatLocalDateTime,
  parseLocalDateTime, validateDate, validateLocation,
} from '../src/observer/astronomy';

test('Suzhou default is explicit east-positive WGS84-style location, 10 m and IANA timezone', () => {
  assert.deepEqual(DEFAULT_LOCATION, { name: '苏州', latitude: 31.2989, longitude: 120.5853, elevation: 10, timezone: 'Asia/Shanghai' });
  LOCATIONS.forEach(location => assert.deepEqual(validateLocation(location), location));
});

test('Suzhou UTC+8 local date round trip is independent of the host timezone', () => {
  const date = parseLocalDateTime('2026-10-13T19:45:12', 'Asia/Shanghai');
  assert.equal(date.toISOString(), '2026-10-13T11:45:12.000Z');
  assert.equal(formatLocalDateTime(date, 'Asia/Shanghai'), '2026-10-13T19:45:12');
  assert.equal(parseLocalDateTime('2026-10-13T19:45', 'Asia/Shanghai').toISOString(), '2026-10-13T11:45:00.000Z');
});

test('UTC location, midnight, date rollover and millisecond truncation', () => {
  assert.equal(parseLocalDateTime('2026-10-13T00:00:00', 'UTC').toISOString(), '2026-10-13T00:00:00.000Z');
  assert.equal(formatLocalDateTime(new Date('2026-10-13T00:00:00.999Z'), 'UTC'), '2026-10-13T00:00:00');
  assert.equal(parseLocalDateTime('2026-01-01T01:00', 'Asia/Shanghai').toISOString(), '2025-12-31T17:00:00.000Z');
});

test('historical Chinese DST is not replaced by a fixed +08 assumption', () => {
  assert.equal(parseLocalDateTime('1989-08-24T10:00', 'Asia/Shanghai').toISOString(), '1989-08-24T01:00:00.000Z');
  assert.equal(parseLocalDateTime('1989-01-24T10:00', 'Asia/Shanghai').toISOString(), '1989-01-24T02:00:00.000Z');
});

test('non-hour offsets and leap day are supported', () => {
  assert.equal(parseLocalDateTime('2024-02-29T12:34:56', 'Asia/Kathmandu').toISOString(), '2024-02-29T06:49:56.000Z');
  assert.equal(parseLocalDateTime('2026-10-13T12:00', 'Asia/Kolkata').toISOString(), '2026-10-13T06:30:00.000Z');
});

test('DST spring gap is rejected and adjacent valid times use the correct offsets', () => {
  assert.throws(() => parseLocalDateTime('2026-03-08T02:30', 'America/New_York'), /nonexistent/);
  assert.equal(parseLocalDateTime('2026-03-08T01:30', 'America/New_York').toISOString(), '2026-03-08T06:30:00.000Z');
  assert.equal(parseLocalDateTime('2026-03-08T03:30', 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z');
});

test('DST autumn repeated clock is explicitly rejected rather than guessed', () => {
  assert.throws(() => parseLocalDateTime('2026-11-01T01:30', 'America/New_York'), /ambiguous/);
  // Formatting an instant is unambiguous, but datetime-local cannot encode the fold.
  assert.equal(formatLocalDateTime(new Date('2026-11-01T05:30:00Z'), 'America/New_York'), '2026-11-01T01:30:00');
  assert.equal(formatLocalDateTime(new Date('2026-11-01T06:30:00Z'), 'America/New_York'), '2026-11-01T01:30:00');
});

test('half-hour DST fold and a skipped calendar day are rejected', () => {
  assert.throws(() => parseLocalDateTime('2026-04-05T01:45', 'Australia/Lord_Howe'), /ambiguous/);
  assert.throws(() => parseLocalDateTime('2026-10-04T02:15', 'Australia/Lord_Howe'), /nonexistent/);
  assert.throws(() => parseLocalDateTime('2011-12-30T12:00', 'Pacific/Apia'), /nonexistent/);
});

test('invalid calendars, leap seconds, UTC suffixes and malformed input are rejected', () => {
  for (const value of ['2023-02-29T12:00', '2026-04-31T12:00', '2026-00-01T12:00', '2026-13-01T12:00',
    '2026-01-00T12:00', '2026-01-01T24:00', '2026-01-01T12:60', '2026-01-01T12:00:60',
    '2026-01-01T12:00Z', '2026-01-01T12:00+08:00', '2026-1-1T12:00', '', 'garbage']) {
    assert.throws(() => parseLocalDateTime(value, 'UTC'), RangeError, value);
  }
});

test('date limits are UTC 1900 through 2100 inclusive, and invalid Dates never propagate NaN', () => {
  validateDate(new Date('1900-01-01T00:00:00Z'));
  validateDate(new Date('2100-12-31T23:59:59.999Z'));
  for (const value of ['1899-12-31T23:59:59.999Z', '2101-01-01T00:00:00Z', 'invalid']) {
    assert.throws(() => computeSky(new Date(value), DEFAULT_LOCATION), RangeError);
    assert.throws(() => formatLocalDateTime(new Date(value), 'UTC'), RangeError);
  }
  assert.throws(() => parseLocalDateTime('1900-01-01T00:00', 'Asia/Shanghai'), RangeError);
});

test('location validation rejects bad numbers and timezones, returns a fresh normalized copy', () => {
  for (const patch of [{ latitude: 90.1 }, { latitude: NaN }, { longitude: -180.1 }, { longitude: Infinity },
    { elevation: -501 }, { elevation: 10001 }, { elevation: '10' }, { name: ' ' },
    { timezone: 'Moon/Base' }, { timezone: '+08:00' }, { timezone: '' }]) {
    assert.throws(() => validateLocation({ ...DEFAULT_LOCATION, ...patch } as any), RangeError);
  }
  const input = { ...DEFAULT_LOCATION, name: '  苏州  ' };
  const result = validateLocation(input);
  assert.notEqual(result, input);
  assert.equal(result.name, '苏州');
  assert.equal(input.name, '  苏州  ');
});

test('timezone is presentation metadata, not a correction applied twice to the ephemeris', () => {
  const date = new Date('2026-10-13T11:00:00Z');
  const a = computeSky(date, DEFAULT_LOCATION);
  const b = computeSky(date, { ...DEFAULT_LOCATION, timezone: 'UTC' });
  assert.deepEqual(a.bodies, b.bodies);
  date.setUTCDate(14);
  assert.equal(a.date.toISOString(), '2026-10-13T11:00:00.000Z');
});
