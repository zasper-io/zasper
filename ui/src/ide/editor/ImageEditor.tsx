import React, { useEffect, useState, useCallback } from 'react';
import { BaseApiUrl } from '../config';
import BreadCrumb from './BreadCrumb';

export default function ImageEditor(props) {
  const { data } = props;
  const [fileContents, setFileContents] = useState('');

  const FetchFileData = useCallback(
    async (path) => {
      const res = await fetch(BaseApiUrl + '/api/contents?type=file&hash=0', {
        method: 'POST',
        body: JSON.stringify({
          path,
        }),
      });
      const resJson = await res.json();
      setFileContents(resJson.content);
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
