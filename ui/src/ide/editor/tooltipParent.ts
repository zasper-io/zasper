import { Extension } from '@codemirror/state';
import { tooltips } from '@codemirror/view';

const HOST_ID = 'cm-tooltip-host';

/**
 * The one element every editor's tooltips hang from, made on first use and kept for the app's life.
 *
 * It exists because CodeMirror copies `view.themeClasses` onto the container it appends here, and
 * those classes carry the editor's own box: the file editor asks for `minHeight="100%"`, so its
 * container arrived 1315px tall and `display: flex`, doubling `#root`'s scroll height and giving the
 * whole app a scrollbar. Being out of flow is what fixes that; see _codemirror.scss for why it is a
 * full-size transparent sheet rather than a zero-sized point.
 */
function tooltipHost(): HTMLElement {
  const root = document.getElementById('root');
  if (root === null) {
    return document.body;
  }
  const existing = document.getElementById(HOST_ID);
  if (existing !== null) {
    return existing;
  }
  const host = document.createElement('div');
  host.id = HOST_ID;
  root.appendChild(host);
  return host;
}

/**
 * Where CodeMirror hangs its tooltips, and in which positioning mode — both of which the app has to
 * state because of `zoom`.
 *
 * `applyZoom` sets CSS `zoom` on `#root`, and a `position: fixed` element inside a zoomed subtree is
 * laid out in the zoomed coordinate space: CodeMirror writes correct window pixels and the browser
 * draws them at pixel × factor. Measured at factor 1.44, a popup told `top: 234.859px` under a cursor
 * whose bottom was 235 rendered at 338. CodeMirror does look for exactly this — `makeAbsolute` in its
 * `readMeasure` — but the test is `dom.offsetParent != body`, and `zoom` sets `offsetParent` to `body`
 * (it is `null` unzoomed), which is the one value that check excludes. So the mode has to be stated:
 * `absolute` is the only one in which CodeMirror divides by a scale it measured, and that measurement
 * does see `zoom`.
 *
 * The parent has to be stated too. Left alone it is the `.cm-editor`, which is inside `.editor-body`'s
 * scroller — a popup below the fold would be clipped — and is one line tall, so the scale read off it
 * came out 1.4589 against a true 1.4401. The host is inside `#root`, so the popup keeps the app's
 * scale and grows with the text beside it, and it is outside every pane that scrolls or clips.
 */
export function zoomAwareTooltips(): Extension {
  return tooltips({ position: 'absolute', parent: tooltipHost() });
}
