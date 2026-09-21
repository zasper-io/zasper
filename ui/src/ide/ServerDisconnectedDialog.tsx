import React, { useEffect, useRef, useState } from 'react';

import { getInfo } from '@/api';
import { BaseWebSocketUrl } from '@/config';
import ConfirmDialog from '@/ide/ConfirmDialog';
import { checkServer, watchServer } from './serverConnection';

const CHECK_MS = 3000;

/**
 * Says so when the server stops answering, and closes itself when it is back. Dismissing it holds for
 * this outage only.
 */
export default function ServerDisconnectedDialog() {
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const wasOffline = useRef(false);

  useEffect(
    () =>
      watchServer((next) => {
        setOffline(next);
        if (!next && wasOffline.current) {
          setDismissed(false);
          // A server restarted with a new token has ended the session; this 401 is what says so.
          getInfo().catch(() => {});
        }
        wasOffline.current = next;
      }),
    []
  );

  useEffect(() => {
    if (!offline) {
      return;
    }
    const timer = setInterval(() => void checkServer(), CHECK_MS);
    return () => clearInterval(timer);
  }, [offline]);

  if (!offline || dismissed) {
    return null;
  }

  const dismiss = () => setDismissed(true);
  return (
    <ConfirmDialog
      title="Server disconnected"
      onCancel={dismiss}
      actions={
        <button className="z-button z-button-secondary" autoFocus onClick={dismiss}>
          Dismiss
        </button>
      }
    >
      <div className="update-kernel-popup">
        <p>
          Zasper stopped answering at <code>{new URL(BaseWebSocketUrl).host}</code>. Nothing can be
          saved or run until it is back. Unsaved changes stay in this tab.
        </p>
      </div>
      <p className="z-note modal-status">
        <span className="z-spinner" /> Checking again every few seconds…
      </p>
    </ConfirmDialog>
  );
}
