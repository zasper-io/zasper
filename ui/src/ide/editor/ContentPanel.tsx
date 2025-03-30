import React from 'react';
import Editor from './Editor';
import { useAtom } from 'jotai';
import { fileTabsAtom } from '../../store/TabState';

export default function ContentPanel(props) {
  const [fileTabsState] = useAtom(fileTabsAtom);
  return (
    <>
      {Object.keys(fileTabsState).map((key, index) => (
        <div
          key={index}
          className={fileTabsState[key].active ? 'tabContent d-block' : 'tabContent d-none'}
        >
          <Editor key={index} data={fileTabsState[key]} />
        </div>
      ))}
    </>
  );
}
