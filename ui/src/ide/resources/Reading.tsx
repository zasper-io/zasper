import './Reading.scss';
import { NEARLY_FULL, percent } from './memory';

interface ReadingProps {
  label: string;
  figure: string;
  /** How full, from 0 to 1. */
  fraction: number;
  /** What the meter is measured against, or what the figure counts. */
  fact?: string;
}

/** One figure with its meter: a line of what and how much, the meter, and a line saying what it means. */
export default function Reading({ label, figure, fraction, fact }: ReadingProps) {
  return (
    <div className="resourceReading">
      <div className="resourceReading-line">
        <span>{label}</span>
        <span className="z-tabular">{figure}</span>
      </div>
      <div
        className={fraction >= NEARLY_FULL ? 'z-meter is-high' : 'z-meter'}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuetext={`${figure}, ${percent(fraction)}`}
      >
        <span style={{ width: percent(fraction) }} />
      </div>
      {fact !== undefined && <div className="resourceReading-fact">{fact}</div>}
    </div>
  );
}
