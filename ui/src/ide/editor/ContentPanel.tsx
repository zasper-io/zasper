import React from 'react';
import Editor from './Editor';
import { useAtom } from 'jotai';
import { fileTabsAtom } from '@/store/TabState';

export default function ContentPanel() {
  const [fileTabsState] = useAtom(fileTabsAtom);
  return (
    <>
      {Object.keys(fileTabsState).map((key, index) => (
        // .is-hidden only hides, leaving the visible display value to .tabContent's own
        // stylesheet — see styles/_base.scss.
        <div
          key={index}
          className={fileTabsState[key].active ? 'tabContent' : 'tabContent is-hidden'}
        >
          <Editor key={index} data={fileTabsState[key]} />
        </div>
      ))}
    </>
  );
}
