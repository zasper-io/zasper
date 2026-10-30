import { createContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Whether markup that needs its scripts is run in a sandboxed frame. Always, on screen. The HTML export
 * (export/toHtml.tsx) turns it off: it removes every script anyway, and a frame would leave nothing.
 */
export const SandboxContext = createContext(true);

/** As tall as a frame grows before it scrolls inside, so one output cannot make the notebook endless. */
const MAX_HEIGHT = 4000;

/** What a frame's own script sends its parent: its height, whenever that changes. */
interface HeightMessage {
  zasperOutputHeight: number;
}

function isHeightMessage(data: unknown): data is HeightMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as HeightMessage).zasperOutputHeight === 'number'
  );
}

// Runs first in the frame, before the output's own scripts, and reports the document's height.
const REPORT_HEIGHT = `<script>(function(){
  function send(){parent.postMessage({zasperOutputHeight:document.documentElement.scrollHeight},'*')}
  new ResizeObserver(send).observe(document.documentElement);
  addEventListener('load',send);
})()</script>`;

/** The theme's text colour and font, which a frame's document does not inherit from the page. */
function pageLook(): string {
  const page = getComputedStyle(document.body);
  return `color:${page.color};font-family:${page.fontFamily};font-size:${page.fontSize}`;
}

/**
 * pageLook, read again whenever the theme changes, which loads the frame again in the new colours. From
 * the attribute the theme is applied by rather than from the setting, which changes first.
 */
function usePageLook(): string {
  const [look, setLook] = useState(pageLook);
  useEffect(() => {
    const observer = new MutationObserver(() => setLook(pageLook()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-accent'],
    });
    return () => observer.disconnect();
  }, []);
  return look;
}

function frameDocument(markup: string, look: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    // Links open in a new tab: the frame may not navigate itself or the IDE.
    '<base target="_blank">',
    `<style>html,body{margin:0;background:transparent}body{${look}}</style>`,
    REPORT_HEIGHT,
    '</head><body>',
    markup,
    '</body></html>',
  ].join('');
}

/**
 * Markup a running kernel sent that needs its scripts, such as Bokeh's or Altair's, run in a frame of its
 * own. `sandbox="allow-scripts"` without `allow-same-origin` gives the frame an opaque origin, so its
 * scripts cannot read this page, its cookies or the server's API, where they would otherwise run as
 * whoever is looking at the notebook. That matters most behind a hub, where every server is under one
 * host: a script in one server's output could otherwise act in another's.
 *
 * The frame has no height of its own, so its first script reports one, and only a message from this
 * frame's window is taken as it.
 */
export function SandboxedOutput({ markup }: { markup: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  const look = usePageLook();
  const doc = useMemo(() => frameDocument(markup, look), [markup, look]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source === null || event.source !== frameRef.current?.contentWindow) {
        return;
      }
      if (isHeightMessage(event.data) && Number.isFinite(event.data.zasperOutputHeight)) {
        setHeight(Math.min(Math.max(0, Math.ceil(event.data.zasperOutputHeight)), MAX_HEIGHT));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={frameRef}
      className="output-sandbox"
      title="Output"
      sandbox="allow-scripts"
      srcDoc={doc}
      style={{ height }}
    />
  );
}
