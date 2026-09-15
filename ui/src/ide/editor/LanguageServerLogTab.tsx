import { useEffect, useState } from 'react';

import { apiErrorMessage, getLanguageServerLog } from '@/api';
import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { FileTab } from '@/store/tabState';
import './LanguageServerLogTab.scss';

interface LanguageServerLogTabProps {
  data: FileTab;
}

/** What a language's server wrote to standard error, and what Zasper said about starting and stopping it. */
export default function LanguageServerLogTab({ data }: LanguageServerLogTabProps) {
  const server = data.path.slice('lsp-log:'.length);
  const [log, setLog] = useState('');
  const [error, setError] = useState('');
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!data.active) {
      return;
    }
    let live = true;
    getLanguageServerLog(server)
      .then((text) => {
        if (live) {
          setLog(text);
          setError('');
        }
      })
      .catch((failure: unknown) => {
        if (live) {
          setError(apiErrorMessage(failure));
        }
      });
    return () => {
      live = false;
    };
  }, [server, data.active, reloads]);

  return (
    <div className="tab-surface">
      <div className={data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        <div className="editor-strip">
          <span>{data.name}</span>
          <span className="editor-strip-actions">
            <IconButton
              icon="refresh-cw"
              label="Refresh"
              onClick={() => setReloads((n) => n + 1)}
            />
          </span>
        </div>
        {error !== '' && (
          <div className="z-notice z-notice-error">
            <Icon name="circle-alert" size={14} />
            <p>{error}</p>
          </div>
        )}
        <pre className="serverLog">{log === '' ? 'Nothing has been written yet.' : log}</pre>
      </div>
    </div>
  );
}
