import React, { useEffect, useState } from 'react';
import { BaseApiUrl } from '../config';
export default function ImageEditor(props) {
  const [fileContents, setFileContents] = useState('');

  const FetchFileData = async (path) => {
    const res = await fetch(BaseApiUrl + '/api/contents?type=file&hash=0', {
      method: 'POST',

      body: JSON.stringify({
        path,
      }),
    });
    const resJson = await res.json();
    setFileContents(resJson.content);
  };

  useEffect(() => {
    if (props.data.load_required === true) {
      FetchFileData(props.data.path);
    }
  }, []);

  return (
    <div className="tab-content">
      <div className={props.data.active ? 'd-block' : 'd-none'}>
        <img src={fileContents} className="imageArea" />
      </div>
    </div>
  );
}
