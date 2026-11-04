/** What a kernel's state is called, for whoever cannot see the dot's colour. */
export function kernelStatusWord(state: string): string {
  return state === 'autorestarting' ? 'restarting' : state;
}

/**
 * A kernel's state as a coloured dot. The colour is all the dot says, so it is hidden from a screen
 * reader and the caller puts `kernelStatusWord` in the control's name beside the label — "test-zasper,
 * busy" — in a `.z-visually-hidden` span.
 */
export default function KernelStatusDot({
  state,
  small = false,
}: {
  state: string;
  small?: boolean;
}) {
  const size = small ? ' kernelStatus-sm' : '';
  return <span className={`kernelStatus${size} ks-${state}`} aria-hidden="true" />;
}
