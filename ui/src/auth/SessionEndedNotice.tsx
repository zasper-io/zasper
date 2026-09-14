import React, { useEffect, useState } from 'react';

import { getInfo, watchSession } from '@/api';
import { Icon } from '@/ide/icons';
import { markSignedOut } from './signedIn';

/**
 * Says so when the session ends under an open IDE: its 24 hours are up, or it was signed out in
 * another window.
 *
 * The page stays where it is rather than going to /login, which would throw away unsaved edits; the
 * notice opens sign-in in a new tab instead. Coming back to this tab, or signing in in another one,
 * asks the server again, and the first request that works clears the notice.
 */
export default function SessionEndedNotice() {
  const [ended, setEnded] = useState(false);

  useEffect(() => watchSession(setEnded), []);

  useEffect(() => {
    if (!ended) {
      return;
    }
    // Or the sign-in tab would take the stale marker as a session and go straight back to the IDE.
    markSignedOut();

    const check = () => {
      getInfo().catch(() => {});
    };
    window.addEventListener('focus', check);
    // Signing in in another tab writes to localStorage, which this tab hears as a storage event.
    window.addEventListener('storage', check);
    return () => {
      window.removeEventListener('focus', check);
      window.removeEventListener('storage', check);
    };
  }, [ended]);

  if (!ended) {
    return null;
  }

  return (
    <div className="z-notice z-notice-error" role="alert">
      <Icon name="circle-alert" size={14} />
      <p>
        <strong>Your session has ended.</strong> Nothing can be saved or run until you sign in
        again. Unsaved changes stay in this tab.
      </p>
      <button
        type="button"
        className="z-button z-button-secondary z-notice-action"
        onClick={() => window.open('/login', '_blank', 'noopener')}
      >
        Sign in
      </button>
    </div>
  );
}
