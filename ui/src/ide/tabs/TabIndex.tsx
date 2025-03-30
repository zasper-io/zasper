import { useAtom } from 'jotai';
import React from 'react';
import { fileTabsAtom, IfileTab, IfileTabDict } from '../../store/TabState';
import { languageModeAtom, terminalsAtom } from '../../store/AppState';
import getFileExtension from '../utils';

export default function TabIndex() {
  const [fileTabsState, setFileTabsState] = useAtom(fileTabsAtom);
  const [, setLanguageMode] = useAtom(languageModeAtom);
  const [terminals, setTerminals] = useAtom(terminalsAtom);

  const handleTabActivate = (name: string, path: string, type: string, kernelspec: string) => {
    const updatedFileTabs = { ...fileTabsState };
    const fileTabData: IfileTab = {
      type,
      path,
      name,
      extension: getFileExtension(name),
      active: true,
      load_required: true,
      kernelspec: kernelspec,
    };

    Object.keys(updatedFileTabs).forEach((key) => {
      updatedFileTabs[key] = {
        ...updatedFileTabs[key],
        active: false,
        load_required: false,
      };
    });
    if (updatedFileTabs[path]) {
      updatedFileTabs[path] = { ...updatedFileTabs[path], active: true };
    } else {
      updatedFileTabs[path] = fileTabData;
    }
    if (updatedFileTabs[path].extension) {
      setLanguageMode(updatedFileTabs[path].extension);
    }

    setFileTabsState(updatedFileTabs);
  };

  const handleTabClose = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();

    const updatedFileTabs: IfileTabDict = Object.assign({}, fileTabsState);
    if (updatedFileTabs[key].type === 'notebook') {
      console.log('notebook close signal');
    }

    if ('Launcher' in updatedFileTabs) {
      updatedFileTabs['Launcher']['active'] = true;
    }
    Object.keys(updatedFileTabs).forEach((key) => {
      updatedFileTabs[key] = { ...updatedFileTabs[key], load_required: false };
    });
    delete updatedFileTabs[key];
    setFileTabsState(updatedFileTabs);

    var updatedterminals = { ...terminals };
    delete updatedterminals[key];
    setTerminals(updatedterminals);
  };

  return (
    <div className="tabHeader">
      <ul className="nav">
        {Object.keys(fileTabsState).map((key, index) => (
          <li key={index} className="nav-item tab-item" role="presentation">
            <button
              type="button"
              className={fileTabsState[key].active ? 'nav-link active' : 'nav-link'}
              onClick={async () =>
                await handleTabActivate(
                  fileTabsState[key].name,
                  fileTabsState[key].path,
                  fileTabsState[key].type,
                  'none'
                )
              }
            >
              {fileTabsState[key].name}
              <span className="editor-button">
                <i
                  className="fas fa-times-circle"
                  onClick={async (e) => await handleTabClose(e, key)}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
