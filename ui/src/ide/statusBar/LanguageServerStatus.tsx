import React from 'react';
import { useAtomValue } from 'jotai';
import { toast } from 'react-toastify';

import { serverLanguageFor } from '@/lsp/languages';
import { restartLanguageServer, stopLanguageServer } from '@/lsp/servers';
import { languageServerListAtom, ServerState, serverStatusAtom } from '@/store/languageServers';
import { useTabActions } from '@/store/tabActions';
import { MenuAction, MenuGroup, StatusPicker } from './StatusMenu';

const STATE_WORDS: Record<ServerState, string> = {
  starting: 'starting',
  ready: 'ready',
  failed: 'failed',
  missing: 'not installed',
  off: 'stopped',
};

interface LanguageServerStatusProps {
  fileName: string;
  /** The server by its key, for a notebook, whose language is its kernel's rather than its name's. */
  server?: string;
}

/**
 * The language server for the file in front (story 19): an item of its own, whose dot and words say
 * whether it is starting, ready or failed, and whose menu restarts it, shows its log or stops it. A
 * language with no server installed says so here and nowhere else, and the menu says what to install.
 */
export default function LanguageServerStatus({ fileName, server }: LanguageServerStatusProps) {
  const statuses = useAtomValue(serverStatusAtom);
  const list = useAtomValue(languageServerListAtom);
  const { openSettings, openLanguageServerLog } = useTabActions();

  const language = server === undefined ? serverLanguageFor(fileName) : { server };
  if (language === null || list === null || !list.enabled) {
    return null;
  }
  const info = list.servers.find((server) => server.language === language.server);
  const status = statuses[language.server];
  if (info === undefined) {
    return null;
  }

  if (status?.state === 'missing' || (status === undefined && !info.found)) {
    return (
      <StatusPicker
        label={
          <>
            <span className="serverDot is-missing" /> No server
          </>
        }
        spokenLabel={`No ${info.name} language server`}
      >
        {(close) => (
          <>
            <MenuGroup label={`No ${info.name} language server`} />
            <li className="serverMenuNote" role="presentation">
              Errors, completion and go to definition need one. {info.server} is the one Zasper
              looks for first:
            </li>
            <li className="serverMenuNote" role="presentation">
              <code>{info.install}</code>
            </li>
            <MenuAction
              label="Copy the command"
              icon="copy"
              onSelect={() => {
                navigator.clipboard
                  ?.writeText(info.install)
                  .then(() => toast.success('Copied the command.'))
                  .catch(() => toast.error('The command could not be copied.'));
                close();
              }}
            />
            <MenuAction
              label="Language server settings"
              icon="settings"
              onSelect={() => {
                openSettings();
                close();
              }}
            />
          </>
        )}
      </StatusPicker>
    );
  }

  const state = status?.state ?? 'starting';
  const name = status?.name || info.server;
  const shown = state === 'failed' ? `${name} failed` : state === 'off' ? `${name} stopped` : name;

  return (
    <StatusPicker
      label={
        <>
          <span className={`serverDot is-${state}`} /> {shown}
        </>
      }
      spokenLabel={`Language server ${name}, ${STATE_WORDS[state]}`}
    >
      {(close) => (
        <>
          <MenuGroup
            label={`${name}${status?.version ? ` ${status.version}` : ''} · ${STATE_WORDS[state]}`}
          />
          {state === 'failed' && status?.message !== undefined && (
            <li className="serverMenuNote" role="presentation">
              {status.message}
            </li>
          )}
          <MenuAction
            label="Restart"
            icon="rotate-ccw"
            onSelect={() => {
              restartLanguageServer(language.server);
              close();
            }}
          />
          <MenuAction
            label="Show log"
            icon="terminal"
            onSelect={() => {
              openLanguageServerLog(language.server, name);
              close();
            }}
          />
          <MenuAction
            label="Stop"
            icon="x"
            disabled={state === 'off' || state === 'failed'}
            onSelect={() => {
              stopLanguageServer(language.server);
              close();
            }}
          />
        </>
      )}
    </StatusPicker>
  );
}
