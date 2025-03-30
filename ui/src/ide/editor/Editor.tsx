import React from 'react';

import FileEditor from './FileEditor';
import Launcher from './Launcher';
import NotebookEditor from './notebook/NotebookEditor';
import TerminalTab from '../terminal/Terminal';
import ImageEditor from './ImageEditor';

export default function Editor(props) {
  if (props.data.type === 'launcher') {
    return <Launcher data={props.data} />;
  }
  if (props.data.type === 'file') {
    if (props.data.extension === 'png') {
      return <ImageEditor data={props.data} />;
    }
    return <FileEditor data={props.data} />;
  }
  if (props.data.type === 'notebook') {
    return <NotebookEditor data={props.data} />;
  }
  if (props.data.type === 'terminal') {
    return <TerminalTab data={props.data} />;
  }
  return <></>;
}
