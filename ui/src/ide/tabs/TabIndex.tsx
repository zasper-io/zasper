import { useAtom, useAtomValue } from 'jotai';
import React from 'react';
import { fileTabsAtom, IfileTab } from '@/store/TabState';
import { useTabActions } from '@/store/TabActions';
import { unsavedTabsAtom } from '@/store/UnsavedState';
import getFileExtension, { getIconToLoad } from '../utils';
import './TabIndex.scss';
import { apiErrorMessage } from '@/api';
import UnsavedChangesDialog from './UnsavedChangesDialog';

export default function TabIndex() {
  const [fileTabsState, setFileTabsState] = useAtom(fileTabsAtom);
  const { closeTab } = useTabActions();
  const unsavedTabs = useAtomValue(unsavedTabsAtom);
  /** The tab waiting on an answer to the save prompt, if one is open. */
  const [pendingClose, setPendingClose] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');

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

    setFileTabsState(updatedFileTabs);
  };

  const handleTabClose = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();

    // An unsaved tab is asked about rather than closed: discarding the work has to be an answer,
    // not a side effect of the click.
    if (unsavedTabs[key]) {
      setPendingClose(key);
      setSaveError('');
      return;
    }
    closeTab(key);
  };

  const saveAndClose = async () => {
    if (!pendingClose) {
      return;
    }
    const key = pendingClose;
    setSaving(true);
    setSaveError('');
    try {
      await unsavedTabs[key]();
    } catch (error: unknown) {
      // Left open on the reason the server gave: the editor is holding the only copy of the work.
      setSaveError(apiErrorMessage(error));
      setSaving(false);
      return;
    }
    setSaving(false);
    setPendingClose(null);
    closeTab(key);
  };

  const discardAndClose = () => {
    if (!pendingClose) {
      return;
    }
    const key = pendingClose;
    setPendingClose(null);
    closeTab(key);
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
              {/* The file's own name for a diff: its tab is named `notes.txt (diff)`, whose
                  extension is `txt (diff)` and whose icon is therefore the unknown one. */}
              <img
                className="tabIcon"
                src={getIconToLoad(fileTabsState[key].diff?.path ?? fileTabsState[key].name)}
                alt=""
              />
              {fileTabsState[key].name}
              {fileTabsState[key].name !== 'Launcher' && (
                <span className="editor-button">
                  <i
                    className="fas fa-times-circle"
                    onClick={async (e) => await handleTabClose(e, key)}
                  />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {pendingClose && (
        <UnsavedChangesDialog
          name={fileTabsState[pendingClose]?.name ?? pendingClose}
          saving={saving}
          error={saveError}
          onSave={saveAndClose}
          onDiscard={discardAndClose}
          onCancel={() => setPendingClose(null)}
        />
      )}
    </div>
  );
}
