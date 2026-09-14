import React, { useEffect, useRef, useState } from 'react';

import { apiErrorMessage, downloadContent } from '@/api';
import { saveAs } from '@/browser';
import { Icon } from '@/ide/icons';
import { baseName } from '@/paths';
import { FileTab } from '@/store/tabState';
import BreadCrumb from './BreadCrumb';

interface PdfViewerProps {
  data: FileTab;
}

/**
 * A PDF, drawn by the viewer the browser already has.
 *
 * The bytes come from the download endpoint rather than from the content model, which would carry
 * them as base64 inside JSON and refuses large files.
 * They are re-wrapped as `application/pdf` because the endpoint answers `application/octet-stream`,
 * which an iframe offers to save instead of showing.
 */
export default function PdfViewer({ data }: PdfViewerProps) {
  const [src, setSrc] = useState('');
  /** Why the file could not be read, when it could not be. */
  const [error, setError] = useState('');
  const objectUrl = useRef<string | null>(null);
  const mounted = useRef(true);
  // Only `false` means no viewer: a browser too old to report either way still gets the frame.
  const noViewer = navigator.pdfViewerEnabled === false;
  const name = data.name || baseName(data.path);

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
    if (data.load_required !== true || noViewer) {
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
  }, [data.path, data.load_required, noViewer]);

  const download = () => {
    downloadContent(data.path)
      .then((blob) => saveAs(blob, name))
      .catch((failure: unknown) => {
        if (mounted.current) {
          setError(apiErrorMessage(failure));
        }
      });
  };

  let pane: React.ReactNode;
  if (error !== '') {
    pane = (
      <div className="z-notice z-notice-error" role="alert">
        <Icon name="circle-alert" size={14} />
        <p>
          <strong>This PDF could not be loaded.</strong> {error}
        </p>
      </div>
    );
  } else if (noViewer) {
    pane = (
      <div className="z-notice z-notice-error" role="alert">
        <Icon name="circle-alert" size={14} />
        <p>
          <strong>{name} cannot be shown here.</strong> This browser has no PDF viewer of its own,
          so there is nothing for the pane to put in the frame.
        </p>
        <button
          type="button"
          className="z-button z-button-secondary z-notice-action"
          onClick={download}
        >
          Download
        </button>
      </div>
    );
  } else if (src === '') {
    pane = (
      <div className="viewerArea viewerArea-wait">
        <p className="z-note">
          <span className="z-spinner" /> Loading {name}…
        </p>
      </div>
    );
  } else {
    pane = (
      <div className="viewerArea viewerArea-pdf">
        <iframe src={src} className="viewerFrame" title={name} />
      </div>
    );
  }

  return (
    <div className="tab-surface">
      <div className={data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        <BreadCrumb path={data.path} />
        {pane}
      </div>
    </div>
  );
}
