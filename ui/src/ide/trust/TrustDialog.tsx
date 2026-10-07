import { useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { toast } from 'react-toastify';

import { apiErrorMessage } from '@/api';
import ConfirmDialog from '@/ide/ConfirmDialog';
import { Icon } from '@/ide/icons';
import { trustAskAtom, trustAtom, useTrustFolder } from '@/store/trust';
import './TrustDialog.scss';

/** The folder a path is in, as typed: `/home/me/work` for `/home/me/work/analysis`. */
export function parentOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return cut <= 0 ? trimmed.slice(0, cut + 1) || '/' : trimmed.slice(0, cut);
}

/**
 * The trust question: asked when an untrusted folder is opened, and again when something in it would run.
 * Escape and Stay restricted never trust. See docs/TRUST.md.
 */
export default function TrustDialog() {
  const [ask, setAsk] = useAtom(trustAskAtom);
  const trust = useAtomValue(trustAtom);
  const trustFolder = useTrustFolder();
  const [parent, setParent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (ask === null || trust === null) {
    return null;
  }
  const folder = trust.folder;
  const above = parentOf(folder);

  const close = () => {
    setParent(false);
    setAsk(null);
  };

  const answer = async () => {
    setBusy(true);
    try {
      await trustFolder(parent ? above : folder);
      const then = ask.reason === 'open' ? undefined : ask.onTrusted;
      close();
      then?.();
    } catch (error) {
      toast.error(`Could not trust the folder: ${apiErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const running = ask.reason === 'run';
  return (
    <ConfirmDialog
      title={
        <span className="trustTitle">
          <Icon name="shield" size={16} />
          {ask.reason === 'open'
            ? 'Do you trust the authors of the files in this folder?'
            : 'Trust this folder to run its code?'}
        </span>
      }
      busy={busy}
      onCancel={close}
      actions={
        <>
          <button
            type="button"
            className="z-button z-button-secondary"
            autoFocus
            disabled={busy}
            onClick={close}
          >
            {ask.reason === 'open' ? 'Stay restricted' : 'Cancel'}
          </button>
          <button type="button" className="z-button" disabled={busy} onClick={() => void answer()}>
            {running ? 'Trust and run' : 'Trust folder'}
          </button>
        </>
      }
    >
      <div className="trustDialog">
        <p className="trustPath">
          <code>{folder}</code>
        </p>
        {ask.reason === 'open' && (
          <>
            <p>
              Trusting it lets Zasper run the code in it for you: a notebook&apos;s kernel when the
              notebook opens, the folder&apos;s own <code>.venv</code>, and language servers that
              build the project. If you did not write these files, or do not know who did, stay
              restricted and read them first.
            </p>
            <p className="z-note">
              Restricted, you can still read every file, notebook and saved output, search, diff,
              and use the terminal.
            </p>
          </>
        )}
        {ask.reason === 'run' && (
          <p>
            Running <strong>{ask.notebook}</strong> starts its kernel, <em>{ask.kernel}</em>, in
            this folder, and runs what its cells say. Trusting the folder runs this cell now, and
            lets everything in the folder run from here on.
          </p>
        )}
        {ask.reason === 'other' && (
          <p>
            To {ask.what}, Zasper runs code from this folder. Trusting it lets that, and everything
            else in the folder, run from here on.
          </p>
        )}
        <label className="z-checkbox trustParent">
          <input
            type="checkbox"
            checked={parent}
            disabled={busy}
            onChange={(event) => setParent(event.target.checked)}
          />
          <span>
            Trust everything in <code>{above}</code>
          </span>
        </label>
      </div>
    </ConfirmDialog>
  );
}
