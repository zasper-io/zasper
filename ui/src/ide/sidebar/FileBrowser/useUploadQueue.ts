import { useEffect, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';

import { ApiError, apiErrorMessage, uploadFile } from '@/api';
import { uploadRequestAtom } from './atoms';
import { IPendingUpload } from './uploads';
import { useTreeEdits } from './useFileTree';

/** 'taken' is a name that is already in use, which is the one failure that can be answered. */
export type UploadState = 'waiting' | 'sending' | 'done' | 'taken' | 'failed';

export interface IUpload extends IPendingUpload {
  state: UploadState;
  /** How much of it has gone out, from 0 to 1. Only meaningful while sending. */
  progress: number;
  /** Why it did not go, for its row to say so. */
  reason: string;
  /** Overwrite whatever is in the way; only ever set by asking to replace. */
  replacing: boolean;
}

export interface IUploadQueue {
  uploads: IUpload[];
  /** Queues files and starts sending them. */
  add: (pending: IPendingUpload[]) => void;
  /** Sends one again, this time overwriting what is in its way. */
  replace: (relativePath: string) => void;
  /** True while anything is still to go. */
  isSending: boolean;
}

const queued = (pending: IPendingUpload): IUpload => ({
  ...pending,
  state: 'waiting',
  progress: 0,
  reason: '',
  replacing: false,
});

/**
 * The upload queue behind the dialog: what is going where, how far each one has got, and what to do
 * about the ones that would overwrite something.
 *
 * Sending is driven by an effect over the list rather than by a loop, so there is one description of
 * what happens next — the first file still waiting — and it holds whether the queue was started by a
 * drop, by the file picker, or by asking to replace something.
 *
 * The dialog closes itself when every file has gone, and the destination is re-read either way, since
 * a batch that failed part-way through has still written the files that went before it.
 */
export function useUploadQueue(parentDir: string, initial: IPendingUpload[]): IUploadQueue {
  const [uploads, setUploads] = useState<IUpload[]>(() => initial.map(queued));
  const setRequest = useSetAtom(uploadRequestAtom);
  const inFlight = useRef<AbortController | null>(null);
  // Armed as soon as a file goes out, and disarmed by handling the end of the batch. What keeps the
  // destination being re-read once per batch rather than once per render: the effect below re-runs
  // whenever the tree changes, and re-reading the tree is the very thing it does at the end.
  const unsettled = useRef(false);
  const { read, expand } = useTreeEdits();

  // Closing the dialog stops what is still going out. Safe to cut off mid-file: the server writes to
  // a temporary file and renames it into place only once the whole body has arrived.
  useEffect(() => () => inFlight.current?.abort(), []);

  useEffect(() => {
    const change = (relativePath: string, to: Partial<IUpload>) =>
      setUploads((all) =>
        all.map((upload) => (upload.relativePath === relativePath ? { ...upload, ...to } : upload))
      );

    const send = async (upload: IUpload) => {
      unsettled.current = true;
      change(upload.relativePath, { state: 'sending', progress: 0, reason: '' });
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        await uploadFile({
          parentDir,
          file: upload.file,
          relativePath: upload.relativePath,
          replace: upload.replacing,
          signal: controller.signal,
          onProgress: (fraction) => change(upload.relativePath, { progress: fraction }),
        });
        change(upload.relativePath, { state: 'done', progress: 1 });
      } catch (error: unknown) {
        const taken = error instanceof ApiError && error.status === 409;
        change(upload.relativePath, {
          state: taken ? 'taken' : 'failed',
          reason: taken ? 'Already there.' : apiErrorMessage(error),
        });
      } finally {
        inFlight.current = null;
      }
    };

    // One at a time: a folder of a hundred files should not open a hundred connections, and a queue
    // that goes in order is a queue whose progress can be read.
    if (uploads.some((upload) => upload.state === 'sending')) {
      return;
    }
    const next = uploads.find((upload) => upload.state === 'waiting');
    if (next !== undefined) {
      void send(next);
      return;
    }
    if (unsettled.current) {
      unsettled.current = false;
      void (parentDir === '' ? read('') : expand(parentDir)).then(() => {
        if (uploads.every((upload) => upload.state === 'done')) {
          setRequest(null);
        }
      });
    }
  }, [uploads, parentDir, read, expand, setRequest]);

  return {
    uploads,
    isSending: uploads.some((upload) => upload.state === 'waiting' || upload.state === 'sending'),

    add: (pending: IPendingUpload[]) =>
      setUploads((all) => {
        const arriving = pending.map(queued);
        const names = new Set(arriving.map((upload) => upload.relativePath));
        // A file chosen again takes the place of the row already listed under that name rather than
        // adding a second one, which would be two uploads racing for the same destination.
        return [...all.filter((upload) => !names.has(upload.relativePath)), ...arriving];
      }),

    replace: (relativePath: string) =>
      setUploads((all) =>
        all.map((upload) =>
          upload.relativePath === relativePath
            ? { ...upload, state: 'waiting', reason: '', replacing: true }
            : upload
        )
      ),
  };
}
