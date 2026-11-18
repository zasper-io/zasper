import { QuestionField } from './questions';

// Two questions as Antigravity CLI 1.5.10 asks them, in one form.
export const AGY_FIELDS: QuestionField[] = [
  {
    name: 'q1',
    schema: {
      type: 'string',
      title: 'Which greeting word?',
      oneOf: [
        { const: '1', title: '(Recommended) hello' },
        { const: '2', title: 'hi' },
        { const: '3', title: 'hey' },
      ],
    },
  },
  {
    name: 'q1_other',
    schema: {
      type: 'string',
      title: 'Other',
      description: 'Optional free-form answer to: Which greeting word?',
    },
  },
  {
    name: 'q2',
    schema: {
      type: 'array',
      title: 'Which extras?',
      items: {
        anyOf: [
          { const: '1', title: 'a docstring' },
          { const: '2', title: 'type hints' },
        ],
      },
    },
  },
  {
    name: 'q2_other',
    schema: {
      type: 'string',
      title: 'Other',
      description: 'Optional free-form answer to: Which extras?',
    },
  },
];
