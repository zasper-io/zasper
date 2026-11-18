import { describe, expect, it } from 'vitest';
import { answersOf, complete, contentOf, initialValues, OTHER, questionInputs } from './questions';
import { AGY_FIELDS } from './questions.fixture';

describe('questionInputs', () => {
  it('reads Antigravity’s questions as choices, each with Other as its last option', () => {
    const [greeting, extras, ...rest] = questionInputs(AGY_FIELDS);

    expect(rest).toEqual([]);
    expect(greeting).toMatchObject({
      kind: 'choice',
      name: 'q1',
      label: 'Which greeting word?',
      multiple: false,
      other: 'q1_other',
      initial: [],
    });
    expect(greeting.kind === 'choice' && greeting.options).toEqual([
      { value: '1', label: 'hello', recommended: true },
      { value: '2', label: 'hi', recommended: false },
      { value: '3', label: 'hey', recommended: false },
    ]);
    expect(extras).toMatchObject({ kind: 'choice', multiple: true, other: 'q2_other' });
  });

  it('reads the other kinds a form can have, in the agent’s order', () => {
    const inputs = questionInputs(
      [
        { name: 'version', schema: { type: 'string', title: 'Version', minLength: 1 } },
        { name: 'when', schema: { type: 'string', title: 'Release date', format: 'date' } },
        {
          name: 'jobs',
          schema: { type: 'integer', title: 'Build jobs', minimum: 1, maximum: 16, default: 4 },
        },
        { name: 'tag', schema: { type: 'boolean', title: 'Tag the commit' } },
        { name: 'size', schema: { type: 'string', enum: ['small', 'large'] } },
        // Not a written answer to anything: there is no `notes` choice.
        { name: 'notes_other', schema: { type: 'string' } },
      ],
      ['version']
    );

    expect(inputs.map((input) => [input.kind, input.name, input.label])).toEqual([
      ['text', 'version', 'Version'],
      ['text', 'when', 'Release date'],
      ['number', 'jobs', 'Build jobs'],
      ['switch', 'tag', 'Tag the commit'],
      ['choice', 'size', 'size'],
      ['text', 'notes_other', 'notes_other'],
    ]);
    expect(inputs[0]).toMatchObject({ required: true, minLength: 1 });
    expect(inputs[1]).toMatchObject({ format: 'date', required: false });
    expect(inputs[2]).toMatchObject({ integer: true, minimum: 1, maximum: 16, initial: '4' });
  });
});

describe('a reply', () => {
  const inputs = questionInputs(AGY_FIELDS);

  it('sends an option, or the written answer when Other is picked, never both', () => {
    const values = {
      ...initialValues(inputs),
      q1: ['2'],
      q1_other: 'howdy',
      q2: ['1', OTHER],
      q2_other: ' a test ',
    };

    const content = contentOf(inputs, values);

    expect(content).toEqual({ q1: '2', q2: ['1'], q2_other: 'a test' });
    expect(answersOf(inputs, content)).toEqual([
      { question: 'Which greeting word?', answer: 'hi' },
      { question: 'Which extras?', answer: 'a docstring, a test' },
    ]);
    expect(contentOf(inputs, { ...values, q1: [OTHER] })).toMatchObject({ q1_other: 'howdy' });
  });

  it('waits for a required field, and counts a written answer as one', () => {
    const asked = questionInputs(AGY_FIELDS, ['q1']);
    const values = initialValues(asked);

    expect(complete(asked, values)).toBe(false);
    expect(complete(asked, { ...values, q1: [OTHER], q1_other: '' })).toBe(false);
    expect(complete(asked, { ...values, q1: [OTHER], q1_other: 'howdy' })).toBe(true);
    expect(complete(asked, { ...values, q1: ['3'] })).toBe(true);
  });

  it('sends numbers as numbers, a switch as true or false, and leaves out an empty field', () => {
    const asked = questionInputs([
      { name: 'jobs', schema: { type: 'integer' } },
      { name: 'ratio', schema: { type: 'number' } },
      { name: 'tag', schema: { type: 'boolean' } },
      { name: 'name', schema: { type: 'string' } },
    ]);

    const content = contentOf(asked, { jobs: '4', ratio: '0.5', tag: false, name: '' });

    expect(content).toEqual({ jobs: 4, ratio: 0.5, tag: false });
    expect(answersOf(asked, content)).toEqual([
      { question: 'jobs', answer: '4' },
      { question: 'ratio', answer: '0.5' },
      { question: 'tag', answer: 'No' },
    ]);
  });
});
