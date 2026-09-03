import React, { useState } from 'react';
import { useAtom } from 'jotai';

import { uploadRequestAtom } from './atoms';
import { IPendingUpload, pendingFromDrop, pendingFromFiles } from './uploads';
import { useUploadQueue } from './useUploadQueue';

/**
 * React has no typing for `webkitdirectory`, and it is the only way to ask for a whole folder: an
 * input without it will not let one be chosen at all.
 */
const FOLDER_ATTRIBUTES = {
  webkitdirectory: 'true',
} as unknown as React.InputHTMLAttributes<HTMLInputElement>;

const NOTHING: IPendingUpload[] = [];

/** What each state says to the reader, for the states that have nothing else to show. */
const WORDING = {
  waiting: 'Waiting',
  sending: '',
  done: 'Uploaded',
  taken: '',
  failed: '',
};

function FileUpload() {
  const [request, setRequest] = useAtom(uploadRequestAtom);
  const [isOver, setIsOver] = useState(false);
  const parentDir = request?.parentDir ?? '';
  // Whatever a drop already chose is queued from the start, so a drop does not ask again for what it
  // has just been given.
  const queue = useUploadQueue(parentDir, request?.pending ?? NOTHING);
  const conflicts = queue.uploads.filter((upload) => upload.state === 'taken');

  const choose = (event: React.ChangeEvent<HTMLInputElement>) => {
    queue.add(pendingFromFiles(event.target.files));
    // So that choosing the same file again is a change, and re-uploads it.
    event.target.value = '';
  };

  const drop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsOver(false);
    void pendingFromDrop(event.dataTransfer).then(queue.add);
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Upload">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head">
            Upload
            <button
              type="button"
              className="modal-btn-close"
              aria-label="Close"
              onClick={() => setRequest(null)}
            >
              <i className="fas fa-times-circle"></i>
            </button>
          </div>
          <div className="modal-body uploadBody">
            <p>
              Into <strong>{parentDir === '' ? 'the project root' : parentDir}</strong>
            </p>
            <div
              className={isOver ? 'uploadDrop is-drop-target' : 'uploadDrop'}
              onDragOver={(event) => {
                event.preventDefault();
                setIsOver(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setIsOver(false);
                }
              }}
              onDrop={drop}
            >
              <p>Drop files or folders here, or choose them:</p>
              <div className="uploadPickers">
                <label>
                  Files
                  <input type="file" multiple onChange={choose} />
                </label>
                <label>
                  Folder
                  <input type="file" onChange={choose} {...FOLDER_ATTRIBUTES} />
                </label>
              </div>
            </div>

            {queue.uploads.length > 0 && (
              <ul className="uploadList list-unstyled">
                {queue.uploads.map((upload) => (
                  <li key={upload.relativePath} className="uploadRow">
                    <span className="uploadName" title={upload.relativePath}>
                      {upload.relativePath}
                    </span>
                    {upload.state === 'sending' && (
                      <progress
                        max={1}
                        value={upload.progress}
                        aria-label={`Uploading ${upload.relativePath}`}
                      />
                    )}
                    {upload.reason !== '' && <span className="uploadReason">{upload.reason}</span>}
                    <span className="uploadState">{WORDING[upload.state]}</span>
                    {upload.state === 'taken' && (
                      <button
                        type="button"
                        className="editor-button"
                        onClick={() => queue.replace(upload.relativePath)}
                      >
                        Replace
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="modal-actions">
            {conflicts.length > 1 && (
              <button
                type="button"
                onClick={() => conflicts.forEach((upload) => queue.replace(upload.relativePath))}
              >
                Replace all
              </button>
            )}
            <button type="button" onClick={() => setRequest(null)}>
              {queue.isSending ? 'Cancel' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FileUpload;
