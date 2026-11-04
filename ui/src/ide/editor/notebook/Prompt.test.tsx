import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Prompt from './Prompt';

function request(content: { prompt?: string; password?: boolean }) {
  return { header: { msg_type: 'input_request' }, parent_header: { msg_id: 'run-1' }, content };
}

describe('Prompt', () => {
  it("is labelled with the kernel's prompt and takes focus", () => {
    render(
      <Prompt
        content={request({ prompt: 'Your name: ' })}
        submitPrompt={vi.fn()}
        toggleShowPrompt={vi.fn()}
      />
    );
    const field = screen.getByLabelText('Your name:');
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('type', 'text');
  });

  it('hides what is typed for getpass()', () => {
    render(
      <Prompt
        content={request({ prompt: 'Password: ', password: true })}
        submitPrompt={vi.fn()}
        toggleShowPrompt={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Password:')).toHaveAttribute('type', 'password');
  });

  it('still has a name when input() is called without a prompt', () => {
    render(
      <Prompt content={request({ prompt: '' })} submitPrompt={vi.fn()} toggleShowPrompt={vi.fn()} />
    );
    expect(screen.getByRole('textbox', { name: 'Input for the running cell' })).toHaveFocus();
  });

  it('answers the request it was raised by on Enter', () => {
    const submitPrompt = vi.fn();
    const toggleShowPrompt = vi.fn();
    render(
      <Prompt
        content={request({ prompt: 'Your name: ' })}
        submitPrompt={submitPrompt}
        toggleShowPrompt={toggleShowPrompt}
      />
    );
    const field = screen.getByLabelText('Your name:');
    fireEvent.change(field, { target: { value: 'Ada' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(submitPrompt).toHaveBeenCalledWith({ msg_id: 'run-1' }, 'Ada');
    expect(toggleShowPrompt).toHaveBeenCalled();
  });
});
