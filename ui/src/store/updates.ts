import { useEffect, useRef } from 'react';
import { atom, useAtom, useAtomValue } from 'jotai';

import { getUpdateStatus, logApiError, UpdateStatus } from '@/api';
import { relativeDate } from '@/ide/sidebar/dates';
import { projectDirAtom } from '@/store/serverInfo';
import { useTabActions } from '@/store/tabActions';

/** What /api/updates last said; null until it has answered. */
export const updateStatusAtom = atom<UpdateStatus | null>(null);

/** A release the status bar was told to stop showing, and until when for a security update. */
export interface HiddenUpdate {
  version: string;
  /** Epoch milliseconds. Absent: until the next version. */
  until?: number;
}

const HIDDEN_KEY = 'zasper:update-hidden';
/** The server asks zasper.io once a day; this only rereads its answer. */
const REREAD_MS = 60 * 60 * 1000;

function readHidden(): HiddenUpdate | null {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return raw === null ? null : (JSON.parse(raw) as HiddenUpdate);
  } catch {
    return null;
  }
}

const hiddenUpdateBaseAtom = atom<HiddenUpdate | null>(readHidden());

export const hiddenUpdateAtom = atom(
  (get) => get(hiddenUpdateBaseAtom),
  (_get, set, hidden: HiddenUpdate | null) => {
    set(hiddenUpdateBaseAtom, hidden);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
    } catch {
      // A private window: hidden for this session only.
    }
  }
);

/** Whether the status bar names a release: a newer one, not hidden, in an install that checks. */
export function showsUpdate(
  status: UpdateStatus | null,
  hidden: HiddenUpdate | null,
  now: number
): boolean {
  if (status === null || !status.checks || !status.available || status.latest === undefined) {
    return false;
  }
  if (hidden === null || hidden.version !== status.latest.version) {
    return true;
  }
  return hidden.until !== undefined && hidden.until <= now;
}

/**
 * Reads the update check for the status bar, and opens What's new on the first launch after an upgrade.
 * Mounted once, from IDE.tsx.
 *
 * What's new waits for the project directory, because a tab opened before the remembered strip is
 * restored stops that restore.
 */
export function useUpdates(): void {
  const [status, setStatus] = useAtom(updateStatusAtom);
  const directory = useAtomValue(projectDirAtom);
  const { openWhatsNew } = useTabActions();
  const opened = useRef(false);

  useEffect(() => {
    const read = () => {
      getUpdateStatus().then(setStatus).catch(logApiError('Could not read the update check:'));
    };
    read();
    const timer = window.setInterval(read, REREAD_MS);
    return () => window.clearInterval(timer);
  }, [setStatus]);

  useEffect(() => {
    if (status?.whats_new === true && directory !== '' && !opened.current) {
      opened.current = true;
      openWhatsNew();
    }
  }, [status, directory, openWhatsNew]);
}

/** The sentence under Settings' version row: what the last check found, and when. */
export function describeUpdateCheck(status: UpdateStatus | null, now: Date = new Date()): string {
  if (status === null) {
    return '';
  }
  if (!status.checks) {
    return 'Installed as a snap, which keeps itself up to date.';
  }
  if (status.checked_at === undefined) {
    return 'Not checked yet.';
  }
  const when = `Checked ${relativeDate(status.checked_at, now)}.`;
  const found =
    status.available && status.latest !== undefined
      ? `${status.latest.version} is available.`
      : status.latest !== undefined
        ? 'This is the newest version.'
        : '';
  const failed = status.error !== undefined ? 'Could not reach zasper.io.' : '';
  return [failed, found, when].filter(Boolean).join(' ');
}
