import React, { useEffect, useCallback } from 'react';

import { useAtom } from 'jotai';

import './StatusBar.scss';
import {
  branchNameAtom,
  columnPositionAtom,
  encodingAtom,
  eolSequenceAtom,
  indentationModeAtom,
  indentationSizeAtom,
  languageModeAtom,
  linePositionAtom,
} from '../../store/AppState';
import { BaseApiUrl } from '../config';

export default function StatusBar() {
  const [indentationMode] = useAtom(indentationModeAtom);
  const [indentationSize] = useAtom(indentationSizeAtom);
  const [languageMode] = useAtom(languageModeAtom);
  const [linePosition] = useAtom(linePositionAtom);
  const [columnPosition] = useAtom(columnPositionAtom);
  const [encoding] = useAtom(encodingAtom);
  const [eolSequence] = useAtom(eolSequenceAtom);
  const [branchName, setBranchName] = useAtom(branchNameAtom);

  const FetchBranchData = useCallback(async () => {
    const res = await fetch(BaseApiUrl + '/api/current-branch');
    const resJson = await res.json();
    setBranchName(resJson.branch);
  }, [setBranchName]);

  useEffect(() => {
    FetchBranchData();
  }, [FetchBranchData]);

  return (
    <div className="statusBar">
      <div className="leftStatus">{branchName}</div>
      <div className="rightStatus">
        <span className="statusItem">
          Ln {linePosition}, Col {columnPosition}
        </span>
        <span className="statusItem">
          {indentationMode}: {indentationSize}
        </span>
        <span className="statusItem">{encoding}</span>
        <span className="statusItem">{eolSequence}</span>
        <span className="statusItem">{languageMode}</span>
      </div>
    </div>
  );
}
