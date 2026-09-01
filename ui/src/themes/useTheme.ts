import { useAtom } from 'jotai';

import { themeAtom } from '../store/Settings';
import { getTheme, ZasperTheme } from '.';

/** The registry entry for the active theme. */
export function useTheme(): ZasperTheme {
  const [theme] = useAtom(themeAtom);
  return getTheme(theme);
}
