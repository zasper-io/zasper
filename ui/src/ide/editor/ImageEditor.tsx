import React, { useEffect, useRef, useState } from 'react';
import { apiErrorMessage, downloadContent } from '@/api';
import { Icon } from '@/ide/icons';
import BreadCrumb from './BreadCrumb';
import { IfileTab } from '@/store/TabState';

interface ImageEditorProps {
  data: IfileTab;
}

/**
 * An image, read from the download endpoint: the content model would carry it as base64 inside JSON,
 * a third larger, and refuses large files. The <img> reads the format from the bytes themselves.
 */
export default function ImageEditor(props: ImageEditorProps) {
  const { data } = props;
  const [src, setSrc] = useState('');
  /** Why the image could not be read, when it could not be. */
  const [error, setError] = useState('');
  const objectUrl = useRef<string | null>(null);
  const mounted = useRef(true);

  // Revoked when the tab closes, not when it goes to the background: see PdfViewer.
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
        const url = URL.createObjectURL(blob);
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
        // otherwise be a broken-image glyph with nothing saying why.
        if (mounted.current) {
          setError(apiErrorMessage(failure));
          setSrc('');
        }
      });
  }, [data.path, data.load_required]);

  return (
    <div className="tab-surface">
      <div className={props.data.active ? 'editor-pane' : 'editor-pane is-hidden'}>
        <BreadCrumb path={data.path} />
        {error !== '' ? (
          <div className="z-notice z-notice-error" role="alert">
            <Icon name="circle-alert" size={14} />
            <p>
              <strong>This image could not be loaded.</strong> {error}
            </p>
          </div>
        ) : (
          <div className="viewerArea viewerArea-image">
            {src !== '' && <img src={src} className="viewerContent" alt={data.name || data.path} />}
          </div>
        )}
      </div>
    </div>
  );
}
