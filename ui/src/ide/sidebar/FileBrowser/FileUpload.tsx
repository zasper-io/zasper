import { useAtom } from 'jotai';
import React, { useState } from 'react';
import { fileUploadParentPathAtom, showFileUploadDialogAtom } from './store';
import { BaseApiUrl } from '../../config';

function FileUpload(props) {
  const [file, setFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [, setShowFileUploadDialog] = useAtom(showFileUploadDialogAtom);
  const [fileUploadParentPath] = useAtom(fileUploadParentPathAtom);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleFileUpload = async () => {
    if (!file) {
      setUploadStatus('Please select a file.');
      return;
    }

    const formData = new FormData();
    formData.append('parentPath', fileUploadParentPath);
    formData.append('file', file);

    try {
      setUploadStatus('Uploading...');

      const response = await fetch(BaseApiUrl + '/api/contents/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload file');
      }

      const result = await response.text();
      setUploadStatus(result);
    } catch (error) {
      setUploadStatus('Error uploading file');
    }
  };

  return (
    <div className="modal" id="exampleModal" aria-labelledby="exampleModalLabel" aria-hidden="true">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head">
            File Upload
            <button
              type="button"
              className="modal-btn-close"
              aria-label="Close"
              onClick={() => setShowFileUploadDialog(false)}
            >
              {' '}
              <i className="fas fa-times-circle"></i>{' '}
            </button>
          </div>
          <div className="modal-body">
            <p>Upload a File to {fileUploadParentPath}</p>
            <input type="file" onChange={handleFileChange} />
            <button onClick={handleFileUpload}>Upload</button>
            <p>{uploadStatus}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FileUpload;
