import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PdfViewer from './PdfViewer';
import { IfileTab } from '@/store/TabState';

const downloadContent = vi.fn();
const saveAs = vi.fn();

vi.mock('@/api', () => ({
  downloadContent: (path: string) => downloadContent(path),
  apiErrorMessage: (error: unknown) => (error as Error).message,
}));

vi.mock('@/browser', () => ({
  saveAs: (blob: Blob, filename: string) => saveAs(blob, filename),
}));

const tab: IfileTab = {
  type: 'file',
  path: 'docs/paper.pdf',
  name: 'paper.pdf',
  active: true,
  extension: 'pdf',
  load_required: true,
  kernelspec: 'none',
};

/** The frame the browser's PDF viewer runs in, which is named after the file. */
function frame(): HTMLIFrameElement | null {
  return document.querySelector('iframe');
}

function setPdfViewerEnabled(value: boolean | undefined) {
  Object.defineProperty(navigator, 'pdfViewerEnabled', { value, configurable: true });
}

describe('PdfViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:pdf');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    setPdfViewerEnabled(undefined);
  });

  it('shows the file in a frame of its own', async () => {
    downloadContent.mockResolvedValue(new Blob(['%PDF-1.7']));

    render(<PdfViewer data={tab} />);

    await waitFor(() => expect(frame()?.getAttribute('src')).toBe('blob:pdf'));
    expect(downloadContent).toHaveBeenCalledWith('docs/paper.pdf');
    expect(frame()?.getAttribute('title')).toBe('paper.pdf');
  });

  it('says it is loading until the bytes arrive', async () => {
    let resolve: (blob: Blob) => void = () => {};
    downloadContent.mockReturnValue(new Promise<Blob>((r) => (resolve = r)));

    render(<PdfViewer data={tab} />);

    expect(screen.getByText('Loading paper.pdf…')).toBeInTheDocument();
    expect(frame()).toBeNull();

    resolve(new Blob(['%PDF-1.7']));
    await waitFor(() => expect(frame()).not.toBeNull());
    expect(screen.queryByText('Loading paper.pdf…')).toBeNull();
  });

  // application/octet-stream, which is what the download endpoint answers, is offered as a save
  // rather than shown.
  it('hands the viewer a blob typed as a PDF', async () => {
    downloadContent.mockResolvedValue(new Blob(['%PDF-1.7']));

    render(<PdfViewer data={tab} />);

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Blob;
    expect(blob.type).toBe('application/pdf');
  });

  it('says why a file it cannot read is not on screen', async () => {
    downloadContent.mockRejectedValue(new Error('Content not found'));

    render(<PdfViewer data={tab} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Content not found');
    expect(frame()).toBeNull();
  });

  it('offers the file as a download in a browser with no viewer', async () => {
    setPdfViewerEnabled(false);
    const bytes = new Blob(['%PDF-1.7']);
    downloadContent.mockResolvedValue(bytes);

    render(<PdfViewer data={tab} />);

    expect(screen.getByRole('alert')).toHaveTextContent('paper.pdf cannot be shown here.');
    expect(downloadContent).not.toHaveBeenCalled();
    expect(frame()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(saveAs).toHaveBeenCalledWith(bytes, 'paper.pdf'));
  });

  it('leaves a tab that has already loaded alone', () => {
    render(<PdfViewer data={{ ...tab, load_required: false }} />);

    expect(downloadContent).not.toHaveBeenCalled();
  });
});
