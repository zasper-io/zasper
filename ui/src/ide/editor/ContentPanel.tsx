import React from 'react';
import Editor from './Editor';
import { useAtom } from 'jotai';
import { fileTabsAtom } from '@/store/TabState';

export default function ContentPanel() {
  const [fileTabsState] = useAtom(fileTabsAtom);
  return (
    <>
      {Object.keys(fileTabsState).map((key) => (
        // .is-hidden only hides, leaving the visible display value to .tabContent's own
        // stylesheet — see styles/_base.scss.
        //
        // Keyed by path, not by position: every tab stays mounted, so closing one shifts the position
        // of every tab after it, and by index React would hand a mounted notebook editor the tab that
        // moved into its place — its cells, and its kernel, which now goes on running either way.
        <div
          key={key}
          className={fileTabsState[key].active ? 'tabContent' : 'tabContent is-hidden'}
        >
          <Editor data={fileTabsState[key]} />
        </div>
      ))}
    </>
  );
}
