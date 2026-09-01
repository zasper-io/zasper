import React, { useEffect, useState, useCallback } from 'react';
import { getFileContent } from '@/api';
import BreadCrumb from './BreadCrumb';
import { IfileTab } from '@/store/TabState';

interface ImageEditorProps {
  data: IfileTab;
}

export default function ImageEditor(props: ImageEditorProps) {
  const { data } = props;
  const [fileContents, setFileContents] = useState('');

  const FetchFileData = useCallback(
    async (path: string) => {
      setFileContents(await getFileContent(path));
    },
    [setFileContents]
  );

  useEffect(() => {
    if (data.load_required === true) {
      FetchFileData(data.path);
    }
  }, [FetchFileData, data]);

  return (
    <div className="tab-content">
      <div className={props.data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        <BreadCrumb path={data.path} />
        {/* .imageArea is the scroll box; the <img> keeps its own aspect ratio inside it. */}
        <div className="imageArea">
          <img
            src={fileContents}
            className="imageContent"
            alt={data.name ? `Image of ${data.name}` : 'Image content'}
          />
        </div>
      </div>
    </div>
  );
}
