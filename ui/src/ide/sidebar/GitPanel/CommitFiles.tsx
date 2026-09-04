import { useEffect, useState } from 'react';

import { apiErrorMessage, CommitDetail, getCommitDetail } from '@/api';
import { baseName, parentDirOf } from '@/paths';

interface CommitFilesProps {
  hash: string;
}

/**
 * What one commit changed, read when its row is opened.
 *
 * A read of its own rather than part of the log: a page of thirty commits is thirty diffs against thirty
 * parents, which is most of the cost of the history for something almost none of the rows are asked
 * about.
 */
export default function CommitFiles({ hash }: CommitFilesProps) {
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // A row opened and closed again while the request was in flight would otherwise set state on a
    // component that has gone.
    let live = true;

    const read = async () => {
      try {
        const answer = await getCommitDetail(hash);
        if (live) {
          setDetail(answer);
          setError('');
        }
      } catch (failure) {
        if (live) {
          // A hash the repository no longer has — a rebase behind the panel's back — is a 404 with the
          // server's own sentence, which is more use here than an empty file list.
          setError(apiErrorMessage(failure));
        }
      }
    };

    void read();
    return () => {
      live = false;
    };
  }, [hash]);

  if (error !== '') {
    return <p className="commit-detail-note">{error}</p>;
  }
  if (detail === null) {
    return <p className="commit-detail-note">Loading…</p>;
  }

  return (
    <div className="commit-detail">
      {/* The rest of the message, which the row above shows only the first line of. */}
      {detail.body !== undefined && detail.body !== '' && (
        <p className="commit-body">{detail.body}</p>
      )}

      {detail.files.length === 0 ? (
        <p className="commit-detail-note">No files changed.</p>
      ) : (
        <ul className="commit-files list-unstyled noborder-list">
          {detail.files.map((file) => (
            <li key={file.path} className="commit-file">
              <span
                className={`change-badge change-badge-${file.status}`}
                title={file.from === undefined ? file.status : `Renamed from ${file.from}`}
              >
                {file.status}
              </span>
              <span
                className="commit-file-name"
                title={file.from === undefined ? file.path : `${file.from} → ${file.path}`}
              >
                {baseName(file.path)}
              </span>
              <span className="commit-file-dir">{parentDirOf(file.path)}</span>
              {/* Nothing for a binary file: git counts no lines in a PNG, and "+0 −0" says it changed
                  by nothing rather than by something uncountable. */}
              {file.isBinary ? (
                <span className="commit-file-binary">binary</span>
              ) : (
                <span className="commit-file-counts">
                  <span className="commit-insertions">+{file.insertions}</span>
                  <span className="commit-deletions">−{file.deletions}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {detail.truncated && (
        <p className="commit-detail-note">Only the first {detail.files.length} files are listed.</p>
      )}
    </div>
  );
}
