import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import QuestionForm from './QuestionForm';
import { questionInputs } from './questions';
import { AGY_FIELDS } from './questions.fixture';

const asked = (required: string[] = []) => ({
  kind: 'question' as const,
  id: 'q-1',
  message: 'The agent has a question.',
  inputs: questionInputs(AGY_FIELDS, required),
});

describe('QuestionForm', () => {
  it('asks each question as a group, nothing picked, and sends what the reader chose', () => {
    const onReply = vi.fn();
    render(<QuestionForm item={asked()} onReply={onReply} />);

    const form = screen.getByRole('form', { name: "The agent's question" });
    expect(within(form).getByText('The agent has a question.')).toBeInTheDocument();
    const greeting = screen.getByRole('group', { name: 'Which greeting word?' });
    expect(
      within(greeting)
        .getAllByRole('radio')
        .every((radio) => !(radio as HTMLInputElement).checked)
    ).toBe(true);
    expect(within(greeting).getByText('Recommended')).toBeInTheDocument();

    fireEvent.click(within(greeting).getByRole('radio', { name: /hello/ }));
    fireEvent.click(within(greeting).getByRole('radio', { name: 'hi' }));
    const extras = screen.getByRole('group', { name: 'Which extras?' });
    fireEvent.click(within(extras).getByRole('checkbox', { name: 'a docstring' }));
    fireEvent.change(
      within(extras).getByRole('textbox', { name: 'Other answer to Which extras?' }),
      {
        target: { value: 'a test' },
      }
    );
    expect(within(extras).getByRole('checkbox', { name: 'Other' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));

    expect(onReply).toHaveBeenCalledWith('q-1', 'accept', {
      q1: '2',
      q2: ['1'],
      q2_other: 'a test',
    });
  });

  it('declines with Skip', () => {
    const onReply = vi.fn();
    render(<QuestionForm item={asked()} onReply={onReply} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(onReply).toHaveBeenCalledWith('q-1', 'decline');
  });

  it('keeps Answer until a required question has one', () => {
    render(<QuestionForm item={asked(['q1'])} onReply={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Answer' })).toBeDisabled();
    expect(screen.getByText('required')).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Other answer to Which greeting word?' }),
      {
        target: { value: 'howdy' },
      }
    );
    expect(screen.getByRole('button', { name: 'Answer' })).toBeEnabled();
  });

  it('gives way to the answers once answered, or says it was skipped or withdrawn', () => {
    const { rerender } = render(
      <QuestionForm
        item={{ ...asked(), reply: { action: 'accept', content: { q1: '1', q2_other: 'a test' } } }}
        onReply={vi.fn()}
      />
    );
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByText('Which greeting word?')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('a test')).toBeInTheDocument();

    rerender(
      <QuestionForm item={{ ...asked(), reply: { action: 'decline' } }} onReply={vi.fn()} />
    );
    expect(screen.getByText('Skipped.')).toBeInTheDocument();

    rerender(<QuestionForm item={{ ...asked(), reply: { action: 'cancel' } }} onReply={vi.fn()} />);
    expect(screen.getByText('Withdrawn.')).toBeInTheDocument();
  });

  it('draws a text field, a number and a switch, labelled', () => {
    const onReply = vi.fn();
    render(
      <QuestionForm
        item={{
          kind: 'question',
          id: 'q-2',
          inputs: questionInputs([
            {
              name: 'version',
              schema: { type: 'string', title: 'Version', description: 'As in the tag.' },
            },
            { name: 'jobs', schema: { type: 'integer', title: 'Build jobs', default: 4 } },
            { name: 'tag', schema: { type: 'boolean', title: 'Tag the commit' } },
          ]),
        }}
        onReply={onReply}
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Version' }), {
      target: { value: '1.2' },
    });
    expect(screen.getByRole('textbox', { name: 'Version' })).toHaveAccessibleDescription(
      'As in the tag.'
    );
    expect(screen.getByRole('spinbutton', { name: 'Build jobs' })).toHaveValue(4);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tag the commit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));

    expect(onReply).toHaveBeenCalledWith('q-2', 'accept', { version: '1.2', jobs: 4, tag: true });
  });
});
