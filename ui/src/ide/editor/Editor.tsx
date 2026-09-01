import React, { lazy, Suspense } from 'react';

import FileEditor from './FileEditor';
import Launcher from './Launcher';
import NotebookEditor from './notebook/NotebookEditor';
import ImageEditor from './ImageEditor';
import { IfileTab } from '@/store/TabState';

// The xterm.js core plus its five addons are only needed once a terminal tab is
// opened, which many sessions never do, so they load on demand.
const TerminalTab = lazy(() => import('../terminal/Terminal'));

interface EditorProps {
  data: IfileTab;
}

export default function Editor(props: EditorProps) {
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
    return (
      <Suspense fallback={<div className="terminalContainer" />}>
        <TerminalTab data={props.data} />
      </Suspense>
    );
  }
  return <></>;
}
