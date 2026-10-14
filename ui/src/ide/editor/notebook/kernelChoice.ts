import { NotebookMetadata } from '@/api';
import { KernelspecsState } from '@/store/kernels';

/** The kernelspec a tab carries when it does not know one, i.e. "ask which kernel". */
export const NO_KERNEL = 'none';

/**
 * Which kernel to start for a notebook that has just been read, or NO_KERNEL when there is no usable
 * answer, which is what raises the picker.
 *
 * Only the Launcher's "new notebook" knows a kernel up front; every other way of opening one passes
 * 'none', so `metadata.kernelspec` is the only record of the kernel the file was saved with. `running`
 * is the kernel of a session already on this file, when there is one.
 */
export function kernelToStart(
  tabKernelspec: string,
  metadata: NotebookMetadata,
  installed: KernelspecsState,
  running?: string
): string {
  // A kernel already running this notebook is a fact about which one is in use rather than an opinion
  // about which to use: asking for any other name starts a second kernel beside it.
  if (running !== undefined && running !== '' && running !== NO_KERNEL) {
    return running;
  }

  // A kernel chosen for this tab outranks the file: a notebook created from the Launcher names none.
  if (tabKernelspec !== '' && tabKernelspec !== NO_KERNEL) {
    return tabKernelspec;
  }

  // Zasper wrote a bare string here before, so both shapes are on disk.
  const saved =
    typeof metadata.kernelspec === 'string' ? metadata.kernelspec : metadata.kernelspec?.name;
  if (saved === undefined || saved === '' || saved === NO_KERNEL) {
    return onlyKernelFor(notebookLanguageOf(metadata), installed);
  }

  // Ask rather than fail: a notebook written elsewhere can name a kernel that is not installed here.
  // An empty list means the kernelspecs have not been fetched yet, which is no evidence either way.
  if (Object.keys(installed).length > 0 && !(saved in installed)) {
    return NO_KERNEL;
  }

  return saved;
}

/** The language a notebook says it is in, as the kernel recorded it, else as its kernelspec does. */
function notebookLanguageOf(metadata: NotebookMetadata): string {
  const fromInfo = metadata.language_info?.name;
  if (typeof fromInfo === 'string' && fromInfo.trim() !== '') {
    return fromInfo.trim();
  }
  const spec = metadata.kernelspec;
  return typeof spec === 'object' && spec !== null ? (spec.language ?? '').trim() : '';
}

/**
 * The one installed kernel in `language`, for a notebook that names no kernel but says what it is in.
 * More than one is a choice of environment, which is the reader's, and none is no answer: both ask.
 */
function onlyKernelFor(language: string, installed: KernelspecsState): string {
  if (language === '') {
    return NO_KERNEL;
  }
  const matching = Object.keys(installed).filter(
    (name) => installed[name].spec?.language?.toLowerCase() === language.toLowerCase()
  );
  return matching.length === 1 ? matching[0] : NO_KERNEL;
}
