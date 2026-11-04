import { useId, useState } from 'react';

import { KernelMessage } from './kernelMessages';

interface PromptProps {
  content: KernelMessage;
  submitPrompt: (parentHeader: KernelMessage, inputValue: string) => void;
  toggleShowPrompt: () => void;
}

/**
 * The reply box for a kernel `input_request` — what `input()` in a cell turns into. The reply goes
 * back with the header of the execution being answered, so it is addressed to a request rather than
 * to a cell.
 *
 * The request's own text is the field's label, and the field takes focus: the run is stopped until it
 * is answered, and focus arriving on a labelled field is what makes a screen reader say so.
 */
const Prompt = (props: PromptProps) => {
  const [inputValue, setInputValue] = useState('');
  const id = useId();
  const { prompt = '', password = false } = props.content.content ?? {};

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      props.submitPrompt(props.content.parent_header, inputValue);
      setInputValue('');
      props.toggleShowPrompt();
    }
  };

  return (
    <div className="cell-prompt">
      {prompt && <label htmlFor={id}>{prompt}</label>}
      <input
        id={id}
        className="z-field"
        // `getpass()` sets `password`, and its answer must not be on screen.
        type={password ? 'password' : 'text'}
        autoComplete="off"
        autoFocus
        aria-label={prompt ? undefined : 'Input for the running cell'}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyPress}
        placeholder="Press Enter to send"
      />
    </div>
  );
};

export default Prompt;
