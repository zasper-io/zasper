import { useEffect, useRef, useState } from 'react';

import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';

import { apiErrorMessage, DiffDocuments, DiffTarget, getDiff } from '@/api';
import { Icon } from '@/ide/icons';
import getFileExtension from '@/ide/utils';
import { IfileTab } from '@/store/TabState';
import { useTheme } from '@/themes/useTheme';
import BreadCrumb from './BreadCrumb';
import languageFor from './language';
import './DiffTab.scss';

interface DiffTabProps {
  data: IfileTab;
  /** Which comparison of which file. Separate from `data`, whose `path` is the tab's own key. */
  target: DiffTarget;
}

/** What each side is, in the words git uses for it. */
function sidesOf(target: DiffTarget): [string, string] {
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
  const { path, staged, ref, from } = props.target;
  const [documents, setDocuments] = useState<DiffDocuments | null>(null);
  const [error, setError] = useState<string>('');
  // Bumped by the button in the head. A diff is true as of when it was read, and the ordinary thing to
  // do with the unstaged one is to keep editing the file it is about.
  const [reloads, setReloads] = useState<number>(0);
  const container = useRef<HTMLDivElement>(null);
  /** The comparison this tab has already read, so being brought forward again is not a re-read. */
  const lastRead = useRef<string>('');
  const theme = useTheme();

  // The parts of the comparison rather than the object holding them: the tab is rebuilt every time
  // another tab is activated, and re-reading a diff on every click of the tab strip is not a refresh.
  //
  // Only while this tab is in front, and only once per comparison: a diff is a `git diff` on the
  // server, and a session restored with several diff tabs would run one for each at boot, none of
  // them being looked at. A diff is active the moment `openDiff` opens it, so nothing about opening
  // one changes; the guard is what a restored tab waits behind.
  useEffect(() => {
    const wanted = JSON.stringify([path, staged, ref, from, reloads]);
    if (!props.data.active || lastRead.current === wanted) {
      return;
    }
    lastRead.current = wanted;

    let live = true;

    const read = async () => {
      try {
        const answer = await getDiff({ path, staged, ref, from });
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
  }, [path, staged, ref, from, reloads, props.data.active]);

  useEffect(() => {
    const parent = container.current;
    if (parent === null || documents === null || documents.isBinary || documents.tooLarge) {
      return;
    }

    const language = languageFor(getFileExtension(path));
    const readOnly = [
      lineNumbers(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      theme.codeMirror,
      ...(language === null ? [] : [language]),
    ];

    const view = new MergeView({
      a: { doc: documents.original, extensions: readOnly },
      b: { doc: documents.modified, extensions: readOnly },
      parent,
      gutter: true,
      highlightChanges: true,
      // A file with one changed line in a thousand is otherwise a diff someone has to go looking
      // through for it.
      collapseUnchanged: { margin: 3, minSize: 4 },
    });
    return () => view.destroy();
  }, [documents, path, theme]);

  const [left, right] = sidesOf(props.target);
  // Two identical sides say nothing by themselves: a notebook run again and not edited is exactly that,
  // and so is a rename with no edit in it.
  const unchanged =
    documents !== null &&
    !documents.isBinary &&
    !documents.tooLarge &&
    documents.original === documents.modified;

  return (
    <div className="tab-content">
      <div className={props.data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        {/* The file's own path, not the tab's key, which is a diff of it. */}
        <BreadCrumb path={path} />

        <div className="diff-head">
          <span className="diff-side">{left}</span>
          <Icon name="arrow-right" className="diff-arrow" />
          <span className="diff-side">{right}</span>
          <button
            type="button"
            className="z-icon-button diff-refresh"
            title="Refresh"
            aria-label="Refresh"
            onClick={() => setReloads((count) => count + 1)}
          >
            <Icon name="refresh-cw" />
          </button>
        </div>

        {from !== undefined && (
          <div className="z-notice">
            <p>Renamed from {from}.</p>
          </div>
        )}
        {documents?.isNotebook === true && (
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
        {unchanged && (
          <div className="z-notice">
            <p>No changes.</p>
          </div>
        )}

        <div className="diff-body" ref={container} />
      </div>
    </div>
  );
}
