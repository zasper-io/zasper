import { requestEmpty, requestJson } from './client';

/** What latest.json on zasper.io says about the newest version. */
export interface Release {
  version: string;
  date: string;
  notes: string;
  /** Below this the update is a security update. */
  minimum?: string;
}

/** Response of /api/updates. */
export interface UpdateStatus {
  version: string;
  /** False in the snap, which snapd keeps up to date. */
  checks: boolean;
  install_method?: string;
  /** The command that updates this install, when it is known. */
  upgrade_command?: string;
  latest?: Release;
  available: boolean;
  /** A newer major version, whose notes say what to change first. */
  major: boolean;
  security: boolean;
  checked_at?: string;
  /** Why the last check failed. */
  error?: string;
  /** True until this version's notes have been shown once. */
  whats_new: boolean;
}

/** One version's part of the changelog. */
export interface ChangelogSection {
  version: string;
  date: string;
  markdown: string;
}

/** Response of /api/updates/whats-new. */
export interface WhatsNew {
  version: string;
  /** The version the notes were last shown for, when it is known. */
  from?: string;
  sections: ChangelogSection[];
}

export function getUpdateStatus(): Promise<UpdateStatus> {
  return requestJson<UpdateStatus>('/api/updates');
}

export function checkForUpdates(): Promise<UpdateStatus> {
  return requestJson<UpdateStatus>('/api/updates/check', { method: 'POST' });
}

export function getWhatsNew(): Promise<WhatsNew> {
  return requestJson<WhatsNew>('/api/updates/whats-new');
}

export function markWhatsNewSeen(): Promise<void> {
  return requestEmpty('/api/updates/whats-new/seen', { method: 'POST' });
}
