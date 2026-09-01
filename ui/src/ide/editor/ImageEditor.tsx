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
      <div className={props.data.active ? 'd-block' : 'd-none'}>
        <BreadCrumb path={data.path} />
        <img
          src={fileContents}
          className="imageArea"
          alt={data.name ? `Image of ${data.name}` : 'Image content'}
        />
      </div>
    </div>
  );
}
