import React from 'react';
import Editor from './Editor';
import { useAtomValue } from 'jotai';
import { tabGroupsAtom } from '@/store/tabState';

/**
 * Every open tab, mounted.
 *
 * Over the halves rather than over one strip, which with one half is the same list it always was. What
 * arranging several of them looks like is the panes' own work; this only stops the store's
 * shape from being a reason they cannot be.
 */
export default function ContentPanel() {
  const groups = useAtomValue(tabGroupsAtom);
  return (
    <>
      {groups.flatMap((group) =>
        Object.keys(group.tabs).map((key) => (
          // .is-hidden only hides, leaving the visible display value to .tab-pane's own
          // stylesheet — see styles/_base.scss.
          //
          // Keyed by the half and the path, not by position: every tab stays mounted, so closing one
          // shifts the position of every tab after it, and by index React would hand a mounted
          // notebook editor the tab that moved into its place — its cells, and its kernel, which now
          // goes on running either way.
          <div
            key={`${group.id}:${key}`}
            className={group.tabs[key].active ? 'tab-pane' : 'tab-pane is-hidden'}
          >
            <Editor data={group.tabs[key]} />
          </div>
        ))
      )}
    </>
  );
}
