import { useState } from 'react';

import ConfirmDialog from '@/ide/ConfirmDialog';

import type { ExportOptions } from './useNotebookExport';

/*
What the HTML export asks before it writes anything.

Only HTML asks. Markdown is the prose *and* the code by definition and a script is the code alone, so
neither has a question to put; those two rows export on the press. This is `ConfirmDialog`, the modal
every confirmation in the app already shares, with its two default answers replaced: an export throws
nothing away, so the destructive red button would be a lie.

The sentence under the checkboxes is the other half of why this is a dialog rather than the second menu
row option C drew. There is one thing that has to be said about an exported page — figures stop being
interactive and widgets stop existing — and a menu row has nowhere to say it.
*/

interface ExportDialogProps {
  /** The name the file will be saved under, so the dialog can show it. */
  filename: string;
  onExport: (options: ExportOptions) => void;
  onCancel: () => void;
}

export default function ExportDialog(props: ExportDialogProps) {
  const [includeCode, setIncludeCode] = useState(true);
  const [includeOutputs, setIncludeOutputs] = useState(true);

  // Both off writes a page with a title and nothing under it. Refused rather than explained: the two
  // controls between them say what is wrong, and a third sentence saying it again would not help.
  const hasSomething = includeCode || includeOutputs;

  return (
    <ConfirmDialog
      title="Export as HTML"
      onCancel={props.onCancel}
      actions={
        <>
          <button className="z-button z-button-secondary" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            className="z-button"
            autoFocus
            disabled={!hasSomething}
            onClick={() => props.onExport({ includeCode, includeOutputs })}
          >
            Export
          </button>
        </>
      }
    >
      <div className="modal-choice">
        <label className="z-checkbox">
          <input
            type="checkbox"
            checked={includeCode}
            onChange={(event) => setIncludeCode(event.target.checked)}
          />
          Include the code
        </label>
      </div>
      <div className="modal-choice">
        <label className="z-checkbox">
          <input
            type="checkbox"
            checked={includeOutputs}
            onChange={(event) => setIncludeOutputs(event.target.checked)}
          />
          Include the outputs
        </label>
      </div>
      <p className="export-dialog-note">
        Saved as <code>{props.filename}</code>. Figures become still images and widgets become their
        text — an exported page runs nothing.
      </p>
    </ConfirmDialog>
  );
}
