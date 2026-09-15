import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';

import { apiErrorMessage, previewReplace, ReplacePreview } from '@/api';
import { Icon } from '@/ide/icons';
import {
  contentQuery,
  leftOutAtom,
  searchOptionsAtom,
  searchPreviewPath,
  searchResultsAtom,
  shownLines,
} from '@/store/projectSearch';
import { useTabActions } from '@/store/tabActions';
import { FileTab } from '@/store/tabState';
import { skippedKeys, useProjectReplace } from '../sidebar/searchPanel/useProjectReplace';
import BreadCrumb from './BreadCrumb';
import { useMergeView } from './useMergeView';
import './DiffTab.scss';

interface SearchPreviewTabProps {
  data: FileTab;
}

/**
 * A file on disk against the same file after the search panel's replace (story 18), opened by pressing
 * one of its rows while the replace row is open. The whole file, including the lines around each match
 * that the panel's rows do not show.
 */
export default function SearchPreviewTab({ data }: SearchPreviewTabProps) {
  const path = searchPreviewPath(data.path);
  const options = useAtomValue(searchOptionsAtom);
  const leftOut = useAtomValue(leftOutAtom);
  const results = useAtomValue(searchResultsAtom);
  const replace = useProjectReplace();
  const { activateTab, closeTab } = useTabActions();
  const [preview, setPreview] = useState<ReplacePreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const file = results.files.find((candidate) => candidate.path === path);
  const target = useMemo(
    () => (file === undefined ? null : { file, lines: shownLines(file, leftOut) }),
    [file, leftOut]
  );
  const asked = JSON.stringify([
    contentQuery({ ...options, replacing: true }),
    path,
    target && skippedKeys(target),
  ]);

  useEffect(() => {
    if (!data.active) {
      return;
    }
    const [query, file, skip] = JSON.parse(asked);
    let live = true;
    previewReplace(query, file, skip ?? [])
      .then((answer) => {
        if (live) {
          setPreview(answer);
          setError('');
        }
      })
      .catch((failure: unknown) => {
        if (live) {
          setPreview(null);
          setError(apiErrorMessage(failure));
        }
      });
    return () => {
      live = false;
    };
  }, [asked, data.active]);

  useMergeView(container, preview?.original ?? null, preview?.replaced ?? null, path);

  const replaceHere = async () => {
    if (target === null) {
      return;
    }
    setBusy(true);
    try {
      await replace([target]);
      closeTab(data.path);
      activateTab(path);
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tab-surface">
      <div className={data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        <BreadCrumb path={path} />

        <div className="editor-strip">
          <span className="diff-side">On disk</span>
          <Icon name="arrow-right" className="diff-arrow" />
          <span className="diff-side">After replacing</span>
          <span className="editor-compare-actions">
            <button
              type="button"
              className="z-button z-button-secondary"
              disabled={target === null || busy}
              onClick={() => void replaceHere()}
            >
              Replace in this file
            </button>
          </span>
        </div>

        {error !== '' && (
          <div className="z-notice z-notice-error">
            <Icon name="circle-alert" size={14} />
            <p>{error}</p>
          </div>
        )}

        <div className="diff-body" ref={container} />
      </div>
    </div>
  );
}
