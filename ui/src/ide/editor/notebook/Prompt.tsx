import { useState } from 'react';

import { IKernelMessage } from './kernelMessages';

interface PromptProps {
  content: IKernelMessage;
  submitPrompt: (cellId: string, parentHeader: IKernelMessage, inputValue: string) => void;
  toggleShowPrompt: () => void;
}

/**
 * The reply box for a kernel `input_request` — what `input()` in a cell turns
 * into. The answer is addressed by the requesting message's msg_id, not by cell
 * index, so a stale prompt cannot answer for the wrong cell.
 */
const Prompt = (props: PromptProps) => {
  const [inputValue, setInputValue] = useState('');

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault(); // Prevent form submission refresh
      props.submitPrompt(
        props.content.parent_header.msg_id,
        props.content.parent_header,
        inputValue
      );
      setInputValue(''); // Clear input after submission
      props.toggleShowPrompt();
    }
  };

  return (
    <div>
      <input
        type="name"
        name="prompt"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyPress}
        placeholder="Type something and press Enter"
      />
    </div>
  );
};

export default Prompt;
