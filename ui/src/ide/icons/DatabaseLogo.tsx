import { DATABASE_LOGOS } from './databaseLogos';
import './DatabaseLogo.scss';

/** Its initials, for an engine with no mark to draw. */
const INITIALS: Record<string, string> = { redshift: 'Rs' };

interface DatabaseLogoProps {
  /** A connection's type, as the server names it. */
  type: string;
  /** Square, in px. */
  size?: number;
}

/**
 * A database's own mark, in its own colour (`--z-db-*`), for saying which engine a connection is. An
 * engine with no mark is its initials in the same box. Always `aria-hidden`: the engine's name is
 * beside it.
 */
export default function DatabaseLogo({ type, size = 24 }: DatabaseLogoProps) {
  const path = DATABASE_LOGOS[type];
  if (path === undefined) {
    return (
      <span
        className="databaseLogo is-initials"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {INITIALS[type] ?? type.slice(0, 2)}
      </span>
    );
  }
  return (
    <svg
      className={`databaseLogo databaseLogo-${type}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      // ClickHouse's bars are inset in their square by a sixth of it, which a CSS percentage cannot
      // say: on a padding it is of the parent's width.
      style={type === 'clickhouse' ? { padding: size / 6 } : undefined}
      aria-hidden="true"
      focusable={false}
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
