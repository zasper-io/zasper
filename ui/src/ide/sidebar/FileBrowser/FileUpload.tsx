import { useAtom } from 'jotai';
import React, { useState } from 'react';
import { fileUploadParentPathAtom, showFileUploadDialogAtom } from './atoms';
import { uploadFile } from '@/api';

function FileUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [, setShowFileUploadDialog] = useAtom(showFileUploadDialogAtom);
  const [fileUploadParentPath] = useAtom(fileUploadParentPathAtom);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files ? e.target.files[0] : null);
  };

  const handleFileUpload = async () => {
    if (!file) {
      setUploadStatus('Please select a file.');
      return;
    }

    try {
      setUploadStatus('Uploading...');
      setUploadStatus(await uploadFile(fileUploadParentPath, file));
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
