import { NotebookOutput } from '@/api';

export const BOKEH_LOAD_MIME = 'application/vnd.bokehjs_load.v0+json';
export const BOKEH_EXEC_MIME = 'application/vnd.bokehjs_exec.v0+json';

const BOKEH_CDN = 'https://cdn.bokeh.org/bokeh';
const BOKEH_FILES = ['bokeh', 'bokeh-gl', 'bokeh-widgets', 'bokeh-tables', 'bokeh-mathjax'];

function script(output: NotebookOutput | undefined): string | undefined {
  const data = output?.data;
  if (typeof data?.[BOKEH_LOAD_MIME] === 'string') {
    return data[BOKEH_LOAD_MIME];
  }
  if (data?.[BOKEH_EXEC_MIME] !== undefined && typeof data['application/javascript'] === 'string') {
    return data['application/javascript'];
  }
  return undefined;
}

/** Whether this is a Bokeh script, which draws in a frame with the HTML before it, or nothing. */
export function isBokehScript(output: NotebookOutput): boolean {
  return script(output) !== undefined;
}

/**
 * Whether this output is the HTML a Bokeh script after it works on: the loader's "Loading BokehJS"
 * line, or the element a chart is drawn into. The script's frame shows it.
 */
export function isBokehTarget(outputs: NotebookOutput[], index: number): boolean {
  const html = outputs[index]?.data?.['text/html'];
  const next = outputs[index + 1];
  if (typeof html !== 'string' || script(next) === undefined) {
    return false;
  }
  const root = next.metadata?.[BOKEH_EXEC_MIME]?.id;
  return root === undefined || html.includes(`data-root-id="${root}"`);
}

/**
 * BokehJS from its CDN, at the version the chart was made with, which `docs_json` names. The loader
 * `output_notebook()` sent ran in a frame of its own, so a chart's frame loads it again: from the
 * browser's cache after the first.
 */
function bokehJs(chart: string): string {
  const version = /"version":"([^"]+)"/.exec(chart)?.[1];
  if (version === undefined) {
    return '';
  }
  const channel = /^\d+\.\d+\.\d+$/.test(version) ? 'release' : 'dev';
  return BOKEH_FILES.map(
    (file) => `<script src="${BOKEH_CDN}/${channel}/${file}-${version}.min.js"></script>`
  ).join('');
}

/** The markup a Bokeh script's frame runs: the HTML before it, BokehJS for a chart, then the script. */
export function bokehMarkup(outputs: NotebookOutput[], index: number): string {
  const output = outputs[index];
  const js = script(output) ?? '';
  const target = index > 0 && isBokehTarget(outputs, index - 1);
  const html = target ? (outputs[index - 1].data['text/html'] as string) : '';
  const chart = output.data?.[BOKEH_EXEC_MIME] !== undefined;
  // A `</script>` in a string, such as a Div's text in `docs_json`, would end the element early.
  const escaped = js.replace(/<\/(script)/gi, '<\\/$1');
  return `${html}${chart ? bokehJs(js) : ''}<script>${escaped}</script>`;
}
