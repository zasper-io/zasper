import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PdfViewer from './PdfViewer';
import { IfileTab } from '@/store/TabState';

const downloadContent = vi.fn();

vi.mock('@/api', () => ({
  downloadContent: (path: string) => downloadContent(path),
  apiErrorMessage: (error: unknown) => (error as Error).message,
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

describe('PdfViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:pdf');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows the file in a frame of its own', async () => {
    downloadContent.mockResolvedValue(new Blob(['%PDF-1.7']));

    render(<PdfViewer data={tab} />);

    await waitFor(() => expect(frame()?.getAttribute('src')).toBe('blob:pdf'));
    expect(downloadContent).toHaveBeenCalledWith('docs/paper.pdf');
    expect(frame()?.getAttribute('title')).toBe('paper.pdf');
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

  it('leaves a tab that has already loaded alone', () => {
    render(<PdfViewer data={{ ...tab, load_required: false }} />);

    expect(downloadContent).not.toHaveBeenCalled();
  });
});
