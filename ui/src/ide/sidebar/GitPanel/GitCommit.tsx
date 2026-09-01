import { useEffect, useState } from 'react';
import { commitAndMaybePush, getUncommittedFiles } from '@/api';
import { PanelProps } from '../types';
import './GitPanel.scss';

export function GitCommit({ hidden }: PanelProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState<string>('');
  // State for push option
  const [pushAfterCommit, setPushAfterCommit] = useState<boolean>(false);

  // Function to fetch the list of uncommitted files
  const fetchFiles = async () => {
    try {
      setFiles(await getUncommittedFiles());
    } catch (error) {
      console.error('Error fetching files:', error);
      setFiles([]);
    }
  };

  useEffect(() => {
    // Refetch when the panel is shown, so the list is not stale from last time.
    fetchFiles();
  }, [hidden]);

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

    commitAndMaybePush(commitMessage, selectedFiles, pushAfterCommit)
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

  // No .projectBanner here: that purple bar means "this is the open project", and this
  // panel already has its own title.
  return (
    <div className="git-commit-content">
      <div>
        <h2 className="z-subheading panel-section-head">Uncommitted files</h2>
        {files && files.length > 0 ? (
          <ul className="file-list list-unstyled noborder-list">
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
          <div className="panel-section-body">
            <p>No uncommitted files found.</p>
          </div>
        )}

        <h2 className="z-subheading panel-section-head">Commit message</h2>
        <div className="panel-section-body">
          <input
            className="gitpanel-input"
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

          <button className="z-button" onClick={handleCommit}>
            Commit {pushAfterCommit ? 'and Push' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
