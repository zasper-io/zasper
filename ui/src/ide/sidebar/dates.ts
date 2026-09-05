// When something happened, written for a sidebar: roughly on the row, exactly in its tooltip. A commit
// in the history and a kernel's last activity both want this, which is why it sits above the two panels
// rather than in either.
//
// Everything here takes RFC 3339, so `new Date` can read it — the history's endpoint used to send Go's
// own time format, which is why it showed no date at all.

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

/**
 * The same thing in the room a 22px row has left for it: `now`, `3m`, `2h`, `5d`, `8w`.
 *
 * A kernel row already carries a name, the notebook the kernel is running and two buttons, and
 * "3 minutes ago" beside those takes the width the path needs. The row says it in full in its tooltip.
 */
export function shortAgo(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) {
    return '';
  }

  const seconds = (now.getTime() - when.getTime()) / 1000;
  if (seconds < MINUTE) {
    return 'now';
  }
  if (seconds < HOUR) {
    return `${Math.floor(seconds / MINUTE)}m`;
  }
  if (seconds < DAY) {
    return `${Math.floor(seconds / HOUR)}h`;
  }
  if (seconds < WEEK) {
    return `${Math.floor(seconds / DAY)}d`;
  }
  return `${Math.floor(seconds / WEEK)}w`;
}

/** The same moment exactly, in the reader's own locale, for the tooltip the row carries. */
export function fullDate(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleString();
}
