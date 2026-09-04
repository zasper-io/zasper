import React, { useCallback, useEffect, useState } from 'react';

import CodeMirror from '@uiw/react-codemirror';
import { go } from '@codemirror/lang-go';
import { keymap, ViewUpdate } from '@codemirror/view';
import { getFileContent, logApiError, saveFile } from '@/api';

import { useAtom } from 'jotai';
import { useTheme } from '@/themes/useTheme';
import { columnPositionAtom, indentationSizeAtom, linePositionAtom } from '@/store/AppState';
import BreadCrumb from './BreadCrumb';
import languageFor from './language';
import { IfileTab } from '@/store/TabState';
import { useUnsavedChanges } from '@/store/UnsavedState';

interface FileEditorProps {
  data: IfileTab;
}

export default function FileEditor(props: FileEditorProps) {
  const [fileContents, setFileContents] = useState('');
  /** What the file held when it was last read or written. */
  const [savedContents, setSavedContents] = useState('');
  const theme = useTheme();

  const saveFileToDisk = useCallback(async () => {
    // The text that was written, not whatever the editor holds by the time the write returns: a
    // keystroke made in between leaves the file unsaved again.
    const written = fileContents;
    await saveFile(props.data.path, written);
    setSavedContents(written);
  }, [fileContents, props.data.path]);

  const handleCmdEnter = () => {
    saveFileToDisk().catch(logApiError('Error saving file:'));

    return true;
  };

  useUnsavedChanges(props.data.path, fileContents !== savedContents, saveFileToDisk);

  const customKeymap = keymap.of([
    {
      key: 'Mod-s',
      run: handleCmdEnter,
    },
  ]);

  const FetchFileData = async (path: string) => {
    const content = await getFileContent(path);
    setFileContents(content);
    setSavedContents(content);
  };

  useEffect(() => {
    if (props.data.load_required === true) {
      FetchFileData(props.data.path);
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
    <div className="tab-content">
      <div className={props.data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        {/* Outside .editor-body2, so it stays put while the file scrolls. */}
        <BreadCrumb path={props.data.path} />
        <div className="editor-body2">
          <CodeMirror
            value={fileContents}
            theme={theme.codeMirror}
            minHeight="100%"
            width="100%"
            extensions={[getExtensionToLoad(), customKeymap]}
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
        </div>
      </div>
    </div>
  );
}
