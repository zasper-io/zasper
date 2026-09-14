import { ICellOutput } from '@/api';

// Outputs a running kernel sent to this page. Only their HTML may run scripts: an output read from a
// notebook file was chosen by whoever wrote the file. Held by identity, so no file can claim a place.
const producedHere = new WeakSet<ICellOutput>();

export function markProducedHere(output: ICellOutput): ICellOutput {
  producedHere.add(output);
  return output;
}

export function isProducedHere(output: ICellOutput): boolean {
  return producedHere.has(output);
}
