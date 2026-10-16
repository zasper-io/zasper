import { useEffect, useRef, useState } from 'react';

import {
  ApiError,
  apiErrorMessage,
  DiffDocuments,
  DiffTarget,
  getDiff,
  getNotebook,
  isSaveConflict,
  saveFile,
  saveNotebook,
} from '@/api';
import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { FileTab } from '@/store/tabState';
import BreadCrumb from './BreadCrumb';
import NotebookDiff from './notebookDiff/NotebookDiff';
import { CellDiff, NotebookDiff as NotebookDiffResult, revertCell } from './notebookDiff/cellDiff';
import { useMergeView } from './useMergeView';
import './DiffTab.scss';

interface DiffTabProps {
  data: FileTab;
  /** Which comparison of which file. Separate from `data`, whose `path` is the tab's own key. */
  target: DiffTarget;
}

/** What each side is, in the words git uses for it. */
function sidesOf(target: DiffTarget): [string, string] {
  if (target.turn !== undefined) {
    return ['Before the turn', 'Now'];
  }
  if (target.ref !== undefined) {
    const short = target.ref.slice(0, 7);
    return [`Parent of ${short}`, short];
  }
  return target.staged === true ? ['HEAD', 'Index'] : ['Index', 'Working tree'];
}

/**
 * One file's changes, side by side.
 *
 * A `MergeView` over the two documents the server sends rather than a rendered patch: it computes and
 * aligns the difference itself, which is also why both sides arrive whole.
 *
 * Both editors are read only. Editing one side of a diff means writing to the index or to a commit,
 * and an editor that looks writable and silently discards what is typed into it is worse than one that
 * does not.
 */
export default function DiffTab(props: DiffTabProps) {
  const { path, staged, ref, from, turn } = props.target;
  const [documents, setDocuments] = useState<DiffDocuments | null>(null);
  const [error, setError] = useState<string>('');
  // Bumped by the button in the head. A diff is true as of when it was read, and the ordinary thing to
  // do with the unstaged one is to keep editing the file it is about.
  const [reloads, setReloads] = useState<number>(0);
  const container = useRef<HTMLDivElement>(null);
  // A notebook's diff opens every output change and closes every metadata change until these say otherwise.
  const [outputsOpen, setOutputsOpen] = useState(true);
  const [metadataOpen, setMetadataOpen] = useState(false);
  /** The comparison this tab has already read, so being brought forward again is not a re-read. */
  const lastRead = useRef<string>('');

  // The parts of the comparison rather than the object holding them: the tab is rebuilt every time
  // another tab is activated, and re-reading a diff on every click of the tab strip is not a refresh.
  //
  // Only while this tab is in front, and only once per comparison: a diff is a `git diff` on the
  // server, and a session restored with several diff tabs would run one for each at boot, none of
  // them being looked at. A diff is active the moment `openDiff` opens it, so nothing about opening
  // one changes; the guard is what a restored tab waits behind.
  useEffect(() => {
    const wanted = JSON.stringify([path, staged, ref, from, turn, reloads]);
    if (!props.data.active || lastRead.current === wanted) {
      return;
    }
    lastRead.current = wanted;

    let live = true;

    const read = async () => {
      try {
        const answer = await getDiff({ path, staged, ref, from, turn });
        if (live) {
          setDocuments(answer);
          setError('');
        }
      } catch (failure) {
        if (live) {
          // A path neither side has — committed or discarded elsewhere while this row was on screen —
          // is a 404 carrying the server's own sentence about it.
          setError(apiErrorMessage(failure));
          setDocuments(null);
        }
      }
    };

    void read();
    return () => {
      live = false;
    };
  }, [path, staged, ref, from, turn, reloads, props.data.active]);

  const cells = documents?.notebook;
  const comparable =
    documents !== null && !documents.isBinary && !documents.tooLarge && cells === undefined;
  /*
   * An agent's turn compares the file before it with the file on disk now, and a change can be undone
   * from here: written straight to disk, checked against the version shown, so that undoing one part
   * and then another composes, and an edit made meanwhile elsewhere is never written over unseen.
   */
  const onDisk = useRef<string | undefined>(undefined);
  useEffect(() => {
    onDisk.current = documents?.hash;
  }, [documents]);
  const [writeError, setWriteError] = useState('');
  const notWritten = (failure: unknown) => {
    setWriteError(
      isSaveConflict(failure)
        ? 'The file changed on disk, so nothing was written. This is how it is now.'
        : apiErrorMessage(failure)
    );
    setReloads((count) => count + 1);
  };

  const revertText =
    turn === undefined || documents === null
      ? undefined
      : (text: string) => {
          const content = documents.modified.includes('\r\n')
            ? text.replace(/\r?\n/g, '\r\n')
            : text;
          saveFile(path, content, onDisk.current).then((hash) => {
            onDisk.current = hash;
            setWriteError('');
          }, notWritten);
        };

  const revertCellChange =
    turn === undefined
      ? undefined
      : (change: CellDiff, comparison: NotebookDiffResult) => {
          const write = async () => {
            const read = await getNotebook(path);
            if (read.hash !== onDisk.current) {
              notWritten(new ApiError('PUT', '/api/contents', 409, 'changed'));
              return;
            }
            const cells = revertCell(read.content.cells, comparison, change);
            onDisk.current = await saveNotebook(path, { ...read.content, cells }, onDisk.current);
            setWriteError('');
            setReloads((count) => count + 1);
          };
          write().catch(notWritten);
        };

  useMergeView(
    container,
    comparable ? documents.original : null,
    comparable ? documents.modified : null,
    path,
    revertText
  );

  const [left, right] = sidesOf(props.target);
  // Two identical sides say nothing by themselves: a notebook run again and not edited is exactly that,
  // and so is a rename with no edit in it.
  const unchanged = comparable && documents.original === documents.modified;

  return (
    <div className="tab-surface">
      <div className={props.data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        {/* The file's own path, not the tab's key, which is a diff of it. */}
        <BreadCrumb path={path} />

        <div className="editor-strip">
          <span className="diff-side">{left}</span>
          <Icon name="arrow-right" className="diff-arrow" />
          <span className="diff-side">{right}</span>
          {cells !== undefined && (
            <span className="diff-switches">
              <IconButton
                icon="image"
                label={outputsOpen ? 'Close every output change' : 'Open every output change'}
                pressed={outputsOpen}
                onClick={() => setOutputsOpen(!outputsOpen)}
              />
              <IconButton
                icon="list-checks"
                label={metadataOpen ? 'Close every metadata change' : 'Open every metadata change'}
                pressed={metadataOpen}
                onClick={() => setMetadataOpen(!metadataOpen)}
              />
            </span>
          )}
          <IconButton
            icon="refresh-cw"
            className="diff-refresh"
            label="Refresh"
            onClick={() => setReloads((count) => count + 1)}
          />
        </div>

        {from !== undefined && (
          <div className="z-notice">
            <p>Renamed from {from}.</p>
          </div>
        )}
        {documents?.isNotebook === true && cells === undefined && (
          <div className="z-notice">
            <p>
              Cell sources only. Outputs, execution counts and metadata are left out, so this is a
              diff of the code and not of the file.
            </p>
          </div>
        )}
        {documents?.isBinary === true && (
          <div className="z-notice">
            <p>This is a binary file, so there is nothing to compare line by line.</p>
          </div>
        )}
        {documents?.tooLarge === true && (
          <div className="z-notice">
            <p>This file is too large to compare.</p>
          </div>
        )}
        {error !== '' && (
          <div className="z-notice z-notice-error">
            <Icon name="circle-alert" size={14} />
            <p>{error}</p>
          </div>
        )}
        {writeError !== '' && (
          <div className="z-notice z-notice-error">
            <Icon name="circle-alert" size={14} />
            <p>{writeError}</p>
          </div>
        )}
        {documents?.changedSince === true && (
          <div className="z-notice">
            <p>
              This file changed after the turn, so Now holds those changes too. Undoing a change
              puts back the part the turn changed, as it was before it.
            </p>
          </div>
        )}
        {unchanged && (
          <div className="z-notice">
            <p>No changes.</p>
          </div>
        )}

        {cells !== undefined ? (
          <NotebookDiff
            original={cells.original}
            modified={cells.modified}
            sides={[left, right]}
            outputsOpen={outputsOpen}
            metadataOpen={metadataOpen}
            onRevert={revertCellChange}
          />
        ) : (
          <div className="diff-body" ref={container} />
        )}
      </div>
    </div>
  );
}
