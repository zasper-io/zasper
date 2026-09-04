import { describe, expect, it } from 'vitest';

import { fullDate, relativeDate } from './dates';

/** A fixed present, so the scale below is the thing being tested rather than the clock. */
const now = new Date('2026-06-15T12:00:00Z');

/** `seconds` before `now`, as the server would write it. */
function before(seconds: number): string {
  return new Date(now.getTime() - seconds * 1000).toISOString();
}

describe('relativeDate', () => {
  it('climbs from seconds to years', () => {
    expect(relativeDate(before(5), now)).toBe('just now');
    expect(relativeDate(before(59), now)).toBe('just now');
    expect(relativeDate(before(60), now)).toBe('1 minute ago');
    expect(relativeDate(before(45 * 60), now)).toBe('45 minutes ago');
    expect(relativeDate(before(3 * 3600), now)).toBe('3 hours ago');
    expect(relativeDate(before(2 * 86400), now)).toBe('2 days ago');
    expect(relativeDate(before(20 * 86400), now)).toBe('2 weeks ago');
    expect(relativeDate(before(120 * 86400), now)).toBe('4 months ago');
    expect(relativeDate(before(800 * 86400), now)).toBe('2 years ago');
  });

  it('rounds down, so nothing is dated later than it happened', () => {
    // 23 hours is not yesterday, and 13 days is not a fortnight.
    expect(relativeDate(before(23 * 3600), now)).toBe('23 hours ago');
    expect(relativeDate(before(13 * 86400 + 3600), now)).toBe('13 days ago');
  });

  it('does not count down to a commit made by a clock that runs ahead', () => {
    // Which happens on any machine whose time is a few minutes out, and "in 4 minutes" beside a commit
    // that already exists reads as a bug in the panel.
    expect(relativeDate(new Date(now.getTime() + 4 * 60_000).toISOString(), now)).toBe('just now');
  });

  it('answers with nothing for a date it cannot read', () => {
    expect(relativeDate('', now)).toBe('');
    expect(relativeDate('not a date', now)).toBe('');
  });
});

describe('fullDate', () => {
  it('reads an RFC 3339 timestamp, and nothing else', () => {
    expect(fullDate('2026-06-15T12:00:00Z')).not.toBe('');
    // Go's own time format, which the endpoint this panel replaced used to send.
    expect(fullDate('2026-06-15 12:00:00 +0000 UTC m=+0.001')).toBe('');
  });
});
