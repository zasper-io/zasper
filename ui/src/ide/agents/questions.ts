/*
A question the agent asks as a form (ACP's elicitation): its fields, as JSON Schema, read into what the
panel draws, and what the reader fills in turned back into the reply. zasper-prototype's
story-agent-question.html draws it.
*/

export interface QuestionOption {
  value: string;
  label: string;
  /** The agent suggests it: Antigravity titles that option "(Recommended) …". */
  recommended: boolean;
}

export type QuestionInput =
  | {
      kind: 'choice';
      name: string;
      label: string;
      description?: string;
      required: boolean;
      /** Any number of the options, rather than one. */
      multiple: boolean;
      options: QuestionOption[];
      /** The field a written answer goes in, drawn as the last option: Antigravity's `q1_other`. */
      other?: string;
      initial: string[];
    }
  | {
      kind: 'text';
      name: string;
      label: string;
      description?: string;
      required: boolean;
      format?: 'email' | 'uri' | 'date' | 'date-time';
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      initial: string;
    }
  | {
      kind: 'number';
      name: string;
      label: string;
      description?: string;
      required: boolean;
      integer: boolean;
      minimum?: number;
      maximum?: number;
      initial: string;
    }
  | {
      kind: 'switch';
      name: string;
      label: string;
      description?: string;
      initial: boolean;
    };

export interface QuestionField {
  name: string;
  schema: any;
}

/** What the reader has filled in, by field: a choice's picked values, a field's text, a switch. */
export type QuestionValues = Record<string, string[] | string | boolean>;

/** The value of a choice whose written answer is picked. */
export const OTHER = '\u0000other';

const RECOMMENDED = /^\(Recommended\)\s*/;

function optionsOf(schema: any): QuestionOption[] {
  const titled: any[] | undefined = schema?.oneOf ?? schema?.anyOf;
  if (Array.isArray(titled)) {
    return titled
      .filter((option) => typeof option?.const === 'string')
      .map((option) => {
        const title = typeof option.title === 'string' ? option.title : option.const;
        return {
          value: option.const,
          label: title.replace(RECOMMENDED, ''),
          recommended: RECOMMENDED.test(title),
        };
      });
  }
  if (Array.isArray(schema?.enum)) {
    return schema.enum
      .filter((value: unknown) => typeof value === 'string')
      .map((value: string) => ({ value, label: value, recommended: false }));
  }
  return [];
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
const number = (value: unknown) => (typeof value === 'number' ? value : undefined);

/** The form's fields as the panel draws them, in the agent's order. */
export function questionInputs(fields: QuestionField[], required: string[] = []): QuestionInput[] {
  const names = new Set(fields.map((field) => field.name));
  // A written answer to a choice, which Antigravity sends as a field of its own right after it.
  const others = new Map<string, string>();
  for (const { name, schema } of fields) {
    const choice = name.replace(/_other$/, '');
    if (choice !== name && names.has(choice) && schema?.type === 'string') {
      const of = fields.find((field) => field.name === choice)?.schema;
      if (optionsOf(of?.type === 'array' ? of.items : of).length > 0) {
        others.set(choice, name);
      }
    }
  }
  const asOther = new Set(others.values());
  const inputs: QuestionInput[] = [];
  for (const { name, schema } of fields) {
    if (asOther.has(name)) continue;
    const common = {
      name,
      label: text(schema?.title) ?? name,
      description: text(schema?.description),
      required: required.includes(name),
    };
    const type = schema?.type;
    if (type === 'array') {
      inputs.push({
        kind: 'choice',
        ...common,
        multiple: true,
        options: optionsOf(schema.items),
        other: others.get(name),
        initial: Array.isArray(schema.default) ? schema.default : [],
      });
    } else if (type === 'string' && optionsOf(schema).length > 0) {
      inputs.push({
        kind: 'choice',
        ...common,
        multiple: false,
        options: optionsOf(schema),
        other: others.get(name),
        initial: text(schema.default) ? [schema.default] : [],
      });
    } else if (type === 'number' || type === 'integer') {
      inputs.push({
        kind: 'number',
        ...common,
        integer: type === 'integer',
        minimum: number(schema.minimum),
        maximum: number(schema.maximum),
        initial: number(schema.default)?.toString() ?? '',
      });
    } else if (type === 'boolean') {
      inputs.push({
        kind: 'switch',
        name,
        label: common.label,
        description: common.description,
        initial: schema.default === true,
      });
    } else {
      inputs.push({
        kind: 'text',
        ...common,
        format: ['email', 'uri', 'date', 'date-time'].includes(schema?.format)
          ? schema.format
          : undefined,
        minLength: number(schema?.minLength),
        maxLength: number(schema?.maxLength),
        pattern: text(schema?.pattern),
        initial: text(schema?.default) ?? '',
      });
    }
  }
  return inputs;
}

export function initialValues(inputs: QuestionInput[]): QuestionValues {
  const values: QuestionValues = {};
  for (const input of inputs) {
    values[input.name] = input.initial;
    if (input.kind === 'choice' && input.other) {
      values[input.other] = '';
    }
  }
  return values;
}

/** Whether every required field has an answer. */
export function complete(inputs: QuestionInput[], values: QuestionValues): boolean {
  return inputs.every((input) => {
    if (input.kind === 'switch' || !input.required) return true;
    if (input.kind === 'choice') {
      const picked = (values[input.name] as string[]) ?? [];
      return (
        picked.some((value) => value !== OTHER) || (input.other ? written(input, values) : false)
      );
    }
    return String(values[input.name] ?? '') !== '';
  });
}

function written(input: QuestionInput & { kind: 'choice' }, values: QuestionValues): boolean {
  const picked = (values[input.name] as string[]) ?? [];
  return (
    input.other !== undefined &&
    picked.includes(OTHER) &&
    String(values[input.other] ?? '').trim() !== ''
  );
}

/** The reply's content: what was filled in, by the agent's field names, leaving out what was not. */
export function contentOf(
  inputs: QuestionInput[],
  values: QuestionValues
): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const input of inputs) {
    const value = values[input.name];
    switch (input.kind) {
      case 'choice': {
        const picked = ((value as string[]) ?? []).filter((each) => each !== OTHER);
        if (input.multiple && picked.length > 0) content[input.name] = picked;
        if (!input.multiple && picked.length > 0) content[input.name] = picked[0];
        if (input.other && written(input, values)) {
          content[input.other] = String(values[input.other]).trim();
        }
        break;
      }
      case 'number':
        if (value !== '' && value !== undefined) {
          content[input.name] = input.integer
            ? parseInt(String(value), 10)
            : parseFloat(String(value));
        }
        break;
      case 'switch':
        content[input.name] = value === true;
        break;
      case 'text':
        if (value === '' || value === undefined) break;
        // The browser's date and time has no zone; the schema's is RFC 3339.
        content[input.name] =
          input.format === 'date-time' && !isNaN(Date.parse(String(value)))
            ? new Date(String(value)).toISOString()
            : value;
        break;
    }
  }
  return content;
}

/** The answers given, each question with its answer in words, for the form once it is answered. */
export function answersOf(
  inputs: QuestionInput[],
  content: Record<string, unknown> = {}
): { question: string; answer: string }[] {
  const answers: { question: string; answer: string }[] = [];
  for (const input of inputs) {
    const value = content[input.name];
    let words: string[] = [];
    if (input.kind === 'choice') {
      const picked = Array.isArray(value) ? value : value === undefined ? [] : [value];
      words = picked.map(
        (each) => input.options.find((option) => option.value === each)?.label ?? String(each)
      );
      if (input.other && typeof content[input.other] === 'string') {
        words.push(content[input.other] as string);
      }
    } else if (input.kind === 'switch') {
      words = value === undefined ? [] : [value ? 'Yes' : 'No'];
    } else if (value !== undefined) {
      words = [String(value)];
    }
    if (words.length > 0) {
      answers.push({ question: input.label, answer: words.join(', ') });
    }
  }
  return answers;
}
