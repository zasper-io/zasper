import React, { useEffect, useRef, useState } from 'react';

import { apiErrorMessage, downloadContent } from '@/api';
import { Icon } from '@/ide/icons';
import { IfileTab } from '@/store/TabState';
import BreadCrumb from './BreadCrumb';

interface PdfViewerProps {
  data: IfileTab;
}

/**
 * A PDF, drawn by the viewer the browser already has.
 *
 * The bytes come from the download endpoint rather than from the content model: that model is text,
 * or a base64 data URL for the few types that have one, and a PDF read as text arrives as mojibake.
 * They are re-wrapped as `application/pdf` because the endpoint answers `application/octet-stream`,
 * which an iframe offers to save instead of showing.
 */
export default function PdfViewer({ data }: PdfViewerProps) {
  const [src, setSrc] = useState('');
  /** Why the file could not be read, when it could not be. */
  const [error, setError] = useState('');
  const objectUrl = useRef<string | null>(null);
  const mounted = useRef(true);

  // Revoked when the tab closes, and not before: `load_required` goes false as soon as any other tab
  // is activated, so an object URL tied to it would be revoked out from under a tab that is merely in
  // the background, leaving a blank viewer on the way back to it.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (objectUrl.current !== null) {
        URL.revokeObjectURL(objectUrl.current);
      }
    };
  }, []);

  useEffect(() => {
    if (data.load_required !== true) {
      return;
    }
    downloadContent(data.path)
      .then((blob) => {
        const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        if (!mounted.current) {
          URL.revokeObjectURL(url);
          return;
        }
        if (objectUrl.current !== null) {
          URL.revokeObjectURL(objectUrl.current);
        }
        objectUrl.current = url;
        setSrc(url);
        setError('');
      })
      .catch((failure: unknown) => {
        // A tab restored from a previous visit can name a file since deleted, and the pane would
        // otherwise be an empty frame with nothing saying why.
        if (mounted.current) {
          setError(apiErrorMessage(failure));
          setSrc('');
        }
      });
  }, [data.path, data.load_required]);

  return (
    <div className="tab-content">
      <div className={data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        <BreadCrumb path={data.path} />
        {error !== '' ? (
          <div className="z-notice z-notice-error" role="alert">
            <Icon name="circle-alert" size={14} />
            <p>
              <strong>This PDF could not be loaded.</strong> {error}
            </p>
          </div>
        ) : (
          src !== '' && <iframe src={src} className="pdfContent" title={data.name || data.path} />
        )}
      </div>
    </div>
  );
}
