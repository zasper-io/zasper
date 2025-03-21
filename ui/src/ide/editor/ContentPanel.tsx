import React from 'react';
import Editor from './Editor';

export default function ContentPanel(props) {
  return (
    <>
      {Object.keys(props.tabs).map((key, index) => (
        <div
          key={index}
          className={props.tabs[key].active ? 'tabContent d-block' : 'tabContent d-none'}
        >
          <Editor key={index} data={props.tabs[key]} sendDataToParent={props.sendDataToParent} />
        </div>
      ))}
    </>
  );
}
