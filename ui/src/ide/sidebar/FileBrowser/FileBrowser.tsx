import { useCallback, useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { v4 as uuidv4 } from 'uuid';

import { createContent, getDirectory, IContentEntry, logApiError } from '@/api';
import getFileExtension from '@/ide/utils';
import { projectNameAtom } from '@/store/AppState';
import { fileTabsAtom, IfileTab } from '@/store/TabState';
import DirectoryItem from './DirectoryItem';
import FileItem from './FileItem';
import FileUpload from './FileUpload';
import { showFileUploadDialogAtom } from './atoms';

interface FileBrowserProps {
  hidden: boolean;
  reloadCount: number;
}

export default function FileBrowser({ hidden, reloadCount }: FileBrowserProps) {
  const [contents, setContents] = useState<IContentEntry[]>([]);
  const [cwd] = useState<string>('');
  const [projectName] = useAtom(projectNameAtom);
  const [showFileUploader] = useAtom(showFileUploadDialogAtom);
  const [fileTabsState, setFileTabsState] = useAtom(fileTabsAtom);

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

  const FetchData = useCallback(async () => {
    try {
      const directory = await getDirectory(cwd);

      const updatedContent = directory.content.map((item) => ({
        ...item,
        id: uuidv4(),
      }));

      setContents(updatedContent);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  }, [cwd, setContents]);

  const handleFileClick = (name: string, path: string, type: string) => {
    handleTabActivate(name, path, type, 'none');
  };

  const createNewFile = async () => {
    await createContent(cwd, 'file').catch(logApiError('Error creating file:'));
    FetchData();
  };

  const createNewDirectory = async () => {
    await createContent(cwd, 'directory').catch(logApiError('Error creating directory:'));
    FetchData();
  };

  useEffect(() => {
    FetchData();
  }, [FetchData, reloadCount]);

  return (
    <>
      <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
        <div className="content-head">
          <div className="z-label">File explorer</div>
        </div>
        {/* The one place the project banner is right: it names the thing this panel
            is a view of. */}
        <div className="projectBanner">
          <div className="projectName">{projectName}</div>
          <div className="projectButtons">
            <button className="editor-button" onClick={createNewFile} title="New file">
              <img src="./images/editor/feather-file-plus.svg" alt="" />
            </button>
            <button className="editor-button" onClick={createNewDirectory} title="New folder">
              <img src="./images/editor/feather-folder-plus.svg" alt="" />
            </button>
          </div>
        </div>
        <div className="content-inner">
          <ul className="file-list list-unstyled noborder-list">
            {contents.map((content, index) =>
              content.type === 'directory' ? (
                <DirectoryItem
                  key={content.id}
                  parentDir={cwd}
                  data={content}
                  handleTabActivate={handleTabActivate}
                />
              ) : (
                <FileItem
                  key={content.id}
                  parentDir={cwd}
                  content={content}
                  handleFileClick={handleFileClick}
                />
              )
            )}
          </ul>
        </div>
      </div>
      {/* A fixed-position dialog, so it is a sibling of the panel rather than a
          child of its scroll area. */}
      {showFileUploader && <FileUpload />}
    </>
  );
}
