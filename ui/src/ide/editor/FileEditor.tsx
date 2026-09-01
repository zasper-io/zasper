import React, { useCallback, useEffect, useState } from 'react';

import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { go } from '@codemirror/lang-go';
import { less } from '@codemirror/lang-less';
import { sass } from '@codemirror/lang-sass';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { keymap, ViewUpdate } from '@codemirror/view';
import { getFileContent, logApiError, saveFile } from '../../api';

import './FileEditor.scss';
import { useAtom } from 'jotai';
import { useTheme } from '../../themes/useTheme';
import { columnPositionAtom, indentationSizeAtom, linePositionAtom } from '../../store/AppState';
import BreadCrumb from './BreadCrumb';
import { IfileTab } from '../../store/TabState';

interface FileEditorProps {
  data: IfileTab;
}

export default function FileEditor(props: FileEditorProps) {
  const [fileContents, setFileContents] = useState('');
  const theme = useTheme();

  const handleCmdEnter = () => {
    saveFile(props.data.path, fileContents).catch(logApiError('Error saving file:'));

    return true;
  };

  const customKeymap = keymap.of([
    {
      key: 'Mod-s',
      run: handleCmdEnter,
    },
  ]);

  const FetchFileData = async (path: string) => {
    setFileContents(await getFileContent(path));
  };

  useEffect(() => {
    if (props.data.load_required === true) {
      FetchFileData(props.data.path);
    }
  }, [props.data]);

  const getExtensionToLoad = () => {
    switch (props.data.extension) {
      case 'go':
      case 'mod':
        return go();
      case 'python':
        return python();
      case 'js':
        return javascript();
      case 'json':
        return json();
      case 'ts':
        return javascript({ jsx: false, typescript: true });
      case 'tsx':
        return javascript({ jsx: true, typescript: true });
      case 'jsx':
        return javascript({ jsx: false, typescript: false });
      case 'html':
        return html();
      case 'css':
        return less();
      case 'sass':
      case 'scss':
        return sass();
      case 'md':
      case 'markdown':
        return markdown({ base: markdownLanguage, codeLanguages: languages });
    }
    return go();
  };
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
      <div className={props.data.active ? 'd-block' : 'd-none'}>
        <div className="editor-body2">
          <BreadCrumb path={props.data.path} />
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
