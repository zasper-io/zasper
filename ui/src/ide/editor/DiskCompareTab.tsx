import { useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { Icon } from '@/ide/icons';
import {
  diskComparePath,
  diskComparesAtom,
  DiskResolution,
  diskResolutionsAtom,
} from '@/store/diskChanges';
import { useTabActions } from '@/store/tabActions';
import { FileTab } from '@/store/tabState';
import BreadCrumb from './BreadCrumb';
import { useMergeView } from './useMergeView';
import './DiffTab.scss';

interface DiskCompareTabProps {
  data: FileTab;
}

/**
 * A file's unsaved edits against the version that has since appeared on disk, opened from the band the
 * file's editor shows. The answer is carried out by that editor, which holds the text.
 */
export default function DiskCompareTab({ data }: DiskCompareTabProps) {
  const path = diskComparePath(data.path);
  const compare = useAtomValue(diskComparesAtom)[path];
  const setResolutions = useSetAtom(diskResolutionsAtom);
  const { activateTab, closeTab } = useTabActions();
  const container = useRef<HTMLDivElement>(null);

  useMergeView(container, compare?.onDisk ?? null, compare?.mine ?? null, path);

  const answer = (resolution: DiskResolution) => {
    setResolutions((all) => ({ ...all, [path]: resolution }));
    closeTab(data.path);
    activateTab(path);
  };

  return (
    <div className="tab-surface">
      <div className={data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        <BreadCrumb path={path} />

        <div className="editor-strip">
          <span className="diff-side">On disk</span>
          <Icon name="arrow-right" className="diff-arrow" />
          <span className="diff-side">Your edits</span>
          {compare !== undefined && (
            <span className="editor-compare-actions">
              <button
                type="button"
                className="z-button z-button-secondary"
                onClick={() => answer('mine')}
              >
                Keep mine
              </button>
              <button
                type="button"
                className="z-button z-button-secondary"
                onClick={() => answer('theirs')}
              >
                Take theirs
              </button>
            </span>
          )}
        </div>

        {compare === undefined && (
          <div className="z-notice">
            <p>
              Nothing left to compare: the editor has kept one of the two versions, or the file was
              closed.
            </p>
          </div>
        )}

        <div className="diff-body" ref={container} />
      </div>
    </div>
  );
}
