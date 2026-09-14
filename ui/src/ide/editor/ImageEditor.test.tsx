import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ImageEditor from './ImageEditor';
import { IfileTab } from '@/store/TabState';

const downloadContent = vi.fn();

vi.mock('@/api', () => ({
  downloadContent: (path: string) => downloadContent(path),
  apiErrorMessage: (error: unknown) => (error as Error).message,
}));

const tab: IfileTab = {
  type: 'file',
  path: 'figures/plot.png',
  name: 'plot.png',
  active: true,
  extension: 'png',
  load_required: true,
  kernelspec: 'none',
};

describe('ImageEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:image');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows the image from its bytes', async () => {
    downloadContent.mockResolvedValue(new Blob(['\x89PNG']));

    render(<ImageEditor data={tab} />);

    const image = await screen.findByRole('img', { name: 'plot.png' });
    expect(image).toHaveAttribute('src', 'blob:image');
    expect(downloadContent).toHaveBeenCalledWith('figures/plot.png');
  });

  it('says why an image it cannot read is not on screen', async () => {
    downloadContent.mockRejectedValue(new Error('Content not found'));

    render(<ImageEditor data={tab} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Content not found');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('lets go of the image when the tab closes', async () => {
    downloadContent.mockResolvedValue(new Blob(['\x89PNG']));
    const { unmount } = render(<ImageEditor data={tab} />);
    await screen.findByRole('img');

    unmount();

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image'));
  });
});
