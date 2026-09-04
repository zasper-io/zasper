// How a commit's date is written in the history: roughly, on the row, and exactly in its tooltip.
// The server sends RFC 3339, so `new Date` can read it — the endpoint this replaces sent Go's own
// time format, which is why the old history showed no date at all.

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
// Rough on purpose: nothing here is meant to be arithmetic, only "a while back".
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function ago(seconds: number, unit: number, name: string): string {
  const count = Math.floor(seconds / unit);
  return `${count} ${name}${count === 1 ? '' : 's'} ago`;
}

/**
 * How long ago something happened, in git's own scale.
 *
 * Written out rather than left to `Intl.RelativeTimeFormat`, which rounds and pluralises per locale:
 * one wording is one a test can assert, and `now` is a parameter for the same reason.
 */
export function relativeDate(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) {
    return '';
  }

  const seconds = (now.getTime() - when.getTime()) / 1000;
  // Also every commit made by a machine whose clock runs ahead, which is common enough that counting
  // down to one — "in 4 minutes", beside a commit that already exists — would read as a bug.
  if (seconds < MINUTE) {
    return 'just now';
  }
  if (seconds < HOUR) {
    return ago(seconds, MINUTE, 'minute');
  }
  if (seconds < DAY) {
    return ago(seconds, HOUR, 'hour');
  }
  if (seconds < 2 * WEEK) {
    return ago(seconds, DAY, 'day');
  }
  if (seconds < 10 * WEEK) {
    return ago(seconds, WEEK, 'week');
  }
  if (seconds < YEAR) {
    return ago(seconds, MONTH, 'month');
  }
  return ago(seconds, YEAR, 'year');
}

/** The same moment exactly, in the reader's own locale, for the tooltip the row carries. */
export function fullDate(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleString();
}
