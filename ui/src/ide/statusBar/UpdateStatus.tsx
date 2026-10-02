import React from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { toast } from 'react-toastify';

import { copyToClipboard } from '@/browser';
import { Icon } from '@/ide/icons';
import { hiddenUpdateAtom, showsUpdate, updateStatusAtom } from '@/store/updates';
import { MenuAction, MenuSeparator, StatusPicker } from './StatusMenu';
import { releaseDate } from '@/ide/editor/WhatsNewTab';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A newer release, at the right end of the bar: its notes, the command that installs it, and a way to stop showing it. */
export default function UpdateStatus() {
  const status = useAtomValue(updateStatusAtom);
  const [hidden, setHidden] = useAtom(hiddenUpdateAtom);

  if (status === null || status.latest === undefined || !showsUpdate(status, hidden, Date.now())) {
    return null;
  }
  const latest = status.latest;
  const command = status.upgrade_command;

  return (
    <StatusPicker
      label={
        <>
          <Icon name={status.security ? 'triangle-alert' : 'cloud-download'} size={12} />{' '}
          {status.security ? `Security update: ${latest.version}` : `${latest.version} available`}
        </>
      }
      spokenLabel={
        status.security
          ? `Zasper ${latest.version} is a security update`
          : `Zasper ${latest.version} is available`
      }
    >
      {(close) => (
        <>
          <li className="z-overlay-group z-label updateMenuHead" role="presentation">
            <span>Zasper {latest.version}</span>
            {status.major && <span className="z-badge">Major</span>}
          </li>
          <li className="updateMenuFact" role="presentation">
            {[latest.date ? releaseDate(latest.date) : '', `you have ${status.version}`]
              .filter(Boolean)
              .join(' · ')}
          </li>
          {latest.notes !== '' && (
            <MenuAction
              label="Release notes"
              icon="scroll-text"
              onSelect={() => {
                window.open(latest.notes, '_blank', 'noopener,noreferrer');
                close();
              }}
            />
          )}
          {command !== undefined && (
            <MenuAction
              label={`Copy “${command}”`}
              icon="copy"
              onSelect={async () => {
                close();
                if (await copyToClipboard(command)) {
                  toast.success(`Copied “${command}”.`);
                } else {
                  toast.error('Could not copy to the clipboard.');
                }
              }}
            />
          )}
          <MenuSeparator />
          <MenuAction
            label={status.security ? 'Hide until tomorrow' : 'Hide until the next version'}
            onSelect={() => {
              setHidden({
                version: latest.version,
                until: status.security ? Date.now() + DAY_MS : undefined,
              });
              close();
            }}
          />
        </>
      )}
    </StatusPicker>
  );
}
