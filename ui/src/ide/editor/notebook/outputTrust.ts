import { NotebookOutput } from '@/api';

// Outputs a running kernel sent to this page. Only their HTML may run scripts: an output read from a
// notebook file was chosen by whoever wrote the file. Held by identity, so no file can claim a place.
const producedHere = new WeakSet<NotebookOutput>();

export function markProducedHere(output: NotebookOutput): NotebookOutput {
  producedHere.add(output);
  return output;
}

export function isProducedHere(output: NotebookOutput): boolean {
  return producedHere.has(output);
}
