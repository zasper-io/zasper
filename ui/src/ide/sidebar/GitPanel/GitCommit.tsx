import { useEffect, useState } from 'react';
import { BaseApiUrl } from '../../config';
import './GitPanel.scss';

export function GitCommit({ display }) {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState<string>('');
  // State for push option
  const [pushAfterCommit, setPushAfterCommit] = useState<boolean>(false);

  // Function to fetch the list of uncommitted files
  const fetchFiles = async () => {
    try {
      const resp = await fetch(BaseApiUrl + '/api/uncommitted-files');
      const respJSON = await resp.json();
      setFiles(respJSON);
    } catch (error) {
      console.error('Error fetching files:', error);
      setFiles([]);
    }
  };

  useEffect(() => {
    // Initial fetch when component mounts
    fetchFiles();
  }, [display]);

  const handleCheckboxChange = (file: string) => {
    setSelectedFiles((prevSelectedFiles) => {
      if (prevSelectedFiles.includes(file)) {
        return prevSelectedFiles.filter((f) => f !== file); // Deselect file
      } else {
        return [...prevSelectedFiles, file]; // Select file
      }
    });
  };

  const handleCommit = () => {
    if (selectedFiles.length === 0) {
      alert('Please select at least one file to commit.');
      return;
    }

    const payload = {
      message: commitMessage,
      files: selectedFiles,
      push: pushAfterCommit, // Include the push option in the payload
    };

    fetch(BaseApiUrl + '/api/commit-and-maybe-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((response) => response.text())
      .then((message) => {
        alert(message);
        // After commit (and push), re-fetch the list of uncommitted files
        fetchFiles();
      })
      .catch((error) => {
        console.error('Error committing changes:', error);
        alert('An error occurred while committing changes.');
      });
  };

  return (
    <>
      <div className="projectBanner">
        <div className="projectName">
          <div>VERSION CONTROL</div>
        </div>
      </div>
      <div className="git-commit-content">
        <div>
          <h6>Uncommitted Files</h6>
          {files && files.length > 0 ? (
            <ul className="file-list list-unstyled">
              {files.map((file, index) => (
                <li key={index} className="list-group-item">
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={file}
                      value={file}
                      onChange={() => handleCheckboxChange(file)}
                    />
                    <label htmlFor={file} className="form-check-label">
                      {file}
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p>No uncommitted files found.</p>
          )}

          <h4>Commit Message</h4>
          <input
            className="command-palette-input"
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Enter commit message"
          />

          <div className="form-check">
            <input
              className="form-check-input"
              type="checkbox"
              checked={pushAfterCommit}
              onChange={() => setPushAfterCommit(!pushAfterCommit)} // Toggle the push option
            />
            <label className="form-check-label">Push after commit</label>
          </div>

          <button className="gitbutton" onClick={handleCommit}>
            Commit {pushAfterCommit ? 'and Push' : ''}{' '}
          </button>
        </div>
      </div>
    </>
  );
}
