import React, { useEffect, useState, useCallback } from 'react';
import { apiErrorMessage, getFileContent } from '@/api';
import { Icon } from '@/ide/icons';
import BreadCrumb from './BreadCrumb';
import { IfileTab } from '@/store/TabState';

interface ImageEditorProps {
  data: IfileTab;
}

export default function ImageEditor(props: ImageEditorProps) {
  const { data } = props;
  const [fileContents, setFileContents] = useState('');
  /** Why the image could not be read, when it could not be. */
  const [error, setError] = useState('');

  const FetchFileData = useCallback(
    async (path: string) => {
      try {
        setFileContents(await getFileContent(path));
        setError('');
      } catch (failure) {
        // A tab restored from a previous visit can name a file since deleted. Without this the read
        // was an unhandled rejection and the pane an <img> with no source: a broken-image glyph, and
        // nothing saying why.
        setError(apiErrorMessage(failure));
        setFileContents('');
      }
    },
    [setFileContents]
  );

  useEffect(() => {
    if (data.load_required === true) {
      void FetchFileData(data.path);
    }
  }, [FetchFileData, data]);

  return (
    <div className="tab-surface">
      <div className={props.data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        <BreadCrumb path={data.path} />
        {error !== '' ? (
          <div className="z-notice z-notice-error" role="alert">
            <Icon name="circle-alert" size={14} />
            <p>
              <strong>This image could not be loaded.</strong> {error}
            </p>
          </div>
        ) : (
          /* .imageArea is the scroll box; the <img> keeps its own aspect ratio inside it. */
          <div className="imageArea">
            <img src={fileContents} className="imageContent" alt={data.name || data.path} />
          </div>
        )}
      </div>
    </div>
  );
}
