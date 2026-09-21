import { atom, useAtom } from 'jotai';
import { toast } from 'react-toastify';

import { apiErrorMessage, getInterpreters, modifyConfig } from '@/api';
import type { InterpreterChoice, PythonInstall } from '@/api/interpreters';

/** Settings → Python interpreter, and the Pythons it can be; null until the server has answered. */
export const interpreterChoiceAtom = atom<InterpreterChoice | null>(null);

/** The Python in use: the chosen one, else the project's own, else undefined for the shell's python3. */
export function pythonInUse(choice: InterpreterChoice): PythonInstall | undefined {
  const path = choice.chosen || choice.automatic;
  return choice.interpreters.find((python) => python.executable === path);
}

/** The choice, and a way to change it that every surface offering it shares. */
export function usePythonInterpreter(): [InterpreterChoice | null, (path: string) => void] {
  const [choice, setChoice] = useAtom(interpreterChoiceAtom);
  // The file editor's language server hears of it through the store; Run asks the server.
  const choose = (path: string) => {
    modifyConfig('python_interpreter', path)
      .then(() => getInterpreters())
      .then(setChoice)
      .catch((error: unknown) =>
        toast.error(`Could not change the Python interpreter: ${apiErrorMessage(error)}`)
      );
  };
  return [choice, choose];
}
