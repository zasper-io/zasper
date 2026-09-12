import React, { useCallback, useEffect, useMemo, useState } from 'react';

import CodeMirror from '@uiw/react-codemirror';
import { go } from '@codemirror/lang-go';
import { keymap, ViewUpdate } from '@codemirror/view';
import { apiErrorMessage, getFileContent, logApiError, saveFile } from '@/api';
import { Icon } from '@/ide/icons';

import { useAtom } from 'jotai';
import { useTheme } from '@/themes/useTheme';
import { columnPositionAtom, indentationSizeAtom, linePositionAtom } from '@/store/AppState';
import BreadCrumb from './BreadCrumb';
import languageFor from './language';
import { IfileTab } from '@/store/TabState';
import { useUnsavedChanges } from '@/store/UnsavedState';
import { zoomAwareTooltips } from './tooltipParent';

interface FileEditorProps {
  data: IfileTab;
}

export default function FileEditor(props: FileEditorProps) {
  const [fileContents, setFileContents] = useState('');
  /** What the file held when it was last read or written. */
  const [savedContents, setSavedContents] = useState('');
  /** Why the file could not be read, when it could not be. */
  const [error, setError] = useState('');
  const theme = useTheme();

  const saveFileToDisk = useCallback(async () => {
    // The text that was written, not whatever the editor holds by the time the write returns: a
    // keystroke made in between leaves the file unsaved again.
    const written = fileContents;
    await saveFile(props.data.path, written);
    setSavedContents(written);
  }, [fileContents, props.data.path]);

  const handleCmdEnter = () => {
    // Nothing to save when the read failed: what the editor holds is the empty starting state, and
    // writing it would create the file the tab is only pointing at.
    if (error !== '') {
      return true;
    }
    saveFileToDisk().catch(logApiError('Error saving file:'));

    return true;
  };

  // Not registered while the read failed, for the same reason: the close prompt must not offer to
  // save a buffer that is not the file.
  useUnsavedChanges(
    props.data.path,
    error === '' && fileContents !== savedContents,
    saveFileToDisk
  );

  const customKeymap = keymap.of([
    {
      key: 'Mod-s',
      run: handleCmdEnter,
    },
  ]);

  // See tooltipParent.ts: a popup left to place itself draws at its own coordinate times the zoom.
  const popupPlacement = useMemo(() => zoomAwareTooltips(), []);

  const FetchFileData = async (path: string) => {
    try {
      const content = await getFileContent(path);
      setFileContents(content);
      setSavedContents(content);
      setError('');
    } catch (failure) {
      // The file is gone, or was never there — a tab restored from a previous visit pointing at
      // something since deleted. Said out loud, because the alternative is an editor that looks like
      // an empty file and writes the deleted file back to disk on the first Mod-S.
      setError(apiErrorMessage(failure));
      setFileContents('');
      setSavedContents('');
    }
  };

  useEffect(() => {
    if (props.data.load_required === true) {
      void FetchFileData(props.data.path);
    }
  }, [props.data]);

  // Go for anything unrecognised, which is what this has always fallen back to.
  const getExtensionToLoad = () => languageFor(props.data.extension) ?? go();
  const [, setLinePosition] = useAtom(linePositionAtom);
  const [, setColumnPosition] = useAtom(columnPositionAtom);
  const [indentationSize] = useAtom(indentationSizeAtom);

  const onUpdate = useCallback(
    (viewUpdate: ViewUpdate) => {
      if (viewUpdate) {
        const { state } = viewUpdate;
        const position = state.selection.main.head;

        // Get the line and column based on the absolute position
        const line = state.doc.lineAt(position); // Get the line info for the cursor position
        const column = position - line.from; // Calculate the column as an offset from line start
        setLinePosition(line.number);
        setColumnPosition(column);
      }
    },
    [setColumnPosition, setLinePosition]
  );

  return (
    <div className="tab-surface">
      <div className={props.data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        {/* Outside .file-editor-body, so it stays put while the file scrolls. */}
        <BreadCrumb path={props.data.path} />
        <div className="file-editor-body">
          {/* No editor once a read failed: it would be the empty starting state wearing the name of
              a file that is not there, and saving it would write that file. The band is the notebook
              editor's, which says the same thing for the same reason. */}
          {error !== '' ? (
            <div className="z-notice z-notice-error" role="alert">
              <Icon name="circle-alert" size={14} />
              <p>
                <strong>This file could not be loaded.</strong> {error}
              </p>
            </div>
          ) : (
            <CodeMirror
              value={fileContents}
              theme={theme.codeMirror}
              minHeight="100%"
              width="100%"
              extensions={[getExtensionToLoad(), popupPlacement, customKeymap]}
              // , linter(jsonParseLinter())
              // linter(esLint(new eslint.Linter(), config)),
              onChange={(fileContents) => {
                setFileContents(fileContents);
              }}
              onUpdate={onUpdate}
              basicSetup={{
                bracketMatching: true,
                highlightActiveLineGutter: true,
                autocompletion: true,
                lintKeymap: true,
                foldGutter: true,
                completionKeymap: true,
                tabSize: indentationSize,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
