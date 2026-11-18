import React, { FormEvent, useId, useState } from 'react';
import { ChatItem } from './chatLog';
import {
  answersOf,
  complete,
  contentOf,
  initialValues,
  OTHER,
  QuestionInput,
  QuestionValues,
} from './questions';

type Question = ChatItem & { kind: 'question' };

const INPUT_TYPES = { email: 'email', uri: 'url', date: 'date', 'date-time': 'datetime-local' };

/**
 * A form the agent asks the reader to fill in, where the permission prompt goes; once answered, the
 * answers. zasper-prototype's story-agent-question.html draws it.
 */
export default function QuestionForm({
  item,
  onReply,
}: {
  item: Question;
  onReply: (id: string, action: 'accept' | 'decline', content?: Record<string, unknown>) => void;
}) {
  if (item.reply !== undefined) {
    return <Answered item={item} />;
  }
  return <Asking item={item} onReply={onReply} />;
}

function Answered({ item }: { item: Question }) {
  const { action, content } = item.reply!;
  if (action === 'accept') {
    const answers = answersOf(item.inputs, content);
    if (answers.length === 0) {
      return <p className="agentQuestion-answers">Answered, with nothing filled in.</p>;
    }
    return (
      <dl className="agentQuestion-answers">
        {answers.map(({ question, answer }, index) => (
          <React.Fragment key={index}>
            <dt>{question}</dt>
            <dd>{answer}</dd>
          </React.Fragment>
        ))}
      </dl>
    );
  }
  return (
    <p className="agentQuestion-answers">{action === 'decline' ? 'Skipped.' : 'Withdrawn.'}</p>
  );
}

function Asking({
  item,
  onReply,
}: {
  item: Question;
  onReply: (id: string, action: 'accept' | 'decline', content?: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<QuestionValues>(() => initialValues(item.inputs));
  const set = (name: string, value: QuestionValues[string]) =>
    setValues((current) => ({ ...current, [name]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onReply(item.id, 'accept', contentOf(item.inputs, values));
  };

  return (
    <form className="agentAsk agentQuestion" aria-label="The agent's question" onSubmit={submit}>
      {item.message && <p className="agentQuestion-message">{item.message}</p>}
      {item.inputs.map((input) => (
        <Input key={input.name} input={input} values={values} set={set} />
      ))}
      <div className="agentAsk-actions">
        <button type="submit" className="z-button" disabled={!complete(item.inputs, values)}>
          Answer
        </button>
        <button
          type="button"
          className="z-button z-button-secondary"
          onClick={() => onReply(item.id, 'decline')}
        >
          Skip
        </button>
      </div>
    </form>
  );
}

function Required() {
  return <span className="agentQuestion-required"> required</span>;
}

function Input({
  input,
  values,
  set,
}: {
  input: QuestionInput;
  values: QuestionValues;
  set: (name: string, value: QuestionValues[string]) => void;
}) {
  const id = useId();
  const help = input.description ? (
    <p className="z-form-help" id={`${id}-help`}>
      {input.description}
    </p>
  ) : null;
  const describedBy = input.description ? `${id}-help` : undefined;

  switch (input.kind) {
    case 'choice': {
      const picked = (values[input.name] as string[]) ?? [];
      const type = input.multiple ? 'checkbox' : 'radio';
      const pick = (value: string, on: boolean) =>
        set(
          input.name,
          !input.multiple
            ? [value]
            : on
              ? [...picked.filter((each) => each !== value), value]
              : picked.filter((each) => each !== value)
        );
      return (
        <fieldset className="agentQuestion-group" aria-describedby={describedBy}>
          <legend>
            {input.label}
            {input.required && <Required />}
          </legend>
          {help}
          {input.options.map((option) => (
            <label className="z-checkbox" key={option.value}>
              <input
                type={type}
                name={id}
                checked={picked.includes(option.value)}
                onChange={(event) => pick(option.value, event.target.checked)}
              />
              {option.label}
              {option.recommended && <span className="z-badge">Recommended</span>}
            </label>
          ))}
          {input.other && (
            <div className="z-checkbox agentQuestion-other">
              <input
                type={type}
                name={id}
                id={`${id}-other`}
                checked={picked.includes(OTHER)}
                onChange={(event) => pick(OTHER, event.target.checked)}
              />
              <label htmlFor={`${id}-other`}>Other</label>
              <input
                className="z-field"
                aria-label={`Other answer to ${input.label}`}
                value={String(values[input.other] ?? '')}
                onChange={(event) => {
                  set(input.other!, event.target.value);
                  if (!picked.includes(OTHER)) pick(OTHER, true);
                }}
              />
            </div>
          )}
        </fieldset>
      );
    }
    case 'switch':
      return (
        <div className="z-form-field">
          <label className="z-checkbox">
            <input
              type="checkbox"
              checked={values[input.name] === true}
              aria-describedby={describedBy}
              onChange={(event) => set(input.name, event.target.checked)}
            />
            {input.label}
          </label>
          {help}
        </div>
      );
    case 'number':
    case 'text':
      return (
        <div className="z-form-field">
          <label className="z-form-label" htmlFor={id}>
            {input.label}
            {input.required && <Required />}
          </label>
          <input
            className="z-field"
            id={id}
            aria-describedby={describedBy}
            required={input.required}
            value={String(values[input.name] ?? '')}
            onChange={(event) => set(input.name, event.target.value)}
            {...(input.kind === 'number'
              ? {
                  type: 'number',
                  step: input.integer ? 1 : 'any',
                  min: input.minimum,
                  max: input.maximum,
                }
              : {
                  type: input.format ? INPUT_TYPES[input.format] : 'text',
                  minLength: input.minLength,
                  maxLength: input.maxLength,
                  pattern: input.pattern,
                })}
          />
          {help}
        </div>
      );
  }
}
