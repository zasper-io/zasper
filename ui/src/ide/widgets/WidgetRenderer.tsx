import { useEffect, useRef, useState } from 'react';
import type { DOMWidgetModel, DOMWidgetView } from '@jupyter-widgets/base';

import type { ZasperWidgetManager } from './widgetManager';

/**
 * Where a widget output gets the runtime that draws it.
 *
 * A notebook's is its kernel's `WidgetBridge`, which loads the runtime on demand; a widget drawn
 * inside another widget's output already has the manager that owns it.
 */
export interface WidgetSource {
  manager(): Promise<ZasperWidgetManager>;
}

/** Shown where a widget would be when no kernel has the model the output names. */
const MISSING_MESSAGE = 'This widget is not in the running kernel. Run the cell again to draw it.';

interface WidgetRendererProps {
  modelId: string;
  widgets: WidgetSource | null;
}

/**
 * One widget in a cell's output.
 *
 * The output holds nothing but a model id: a widget's state lives in the kernel and reaches the
 * manager over the comm the kernel opens for it, or is asked for when a reloaded page finds a widget
 * that was drawn before it. So a widget whose model is in neither — a notebook read from disk whose
 * kernel has since been restarted — is not a failure but a cell to run again.
 */
const WidgetRenderer = ({ modelId, widgets }: WidgetRendererProps) => {
  const host = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    setFailure(undefined);

    if (!widgets) {
      setFailure(MISSING_MESSAGE);
      return;
    }

    let cancelled = false;
    let dismiss: (() => void) | undefined;

    void (async () => {
      try {
        const manager = await widgets.manager();
        // A widget the kernel displayed is one with something to draw, so its view is a DOM view.
        const model = (await manager.get_model(modelId)) as DOMWidgetModel;
        const created = (await manager.create_view(model)) as DOMWidgetView;
        if (cancelled || !host.current) {
          manager.removeView(created);
          return;
        }
        dismiss = () => manager.removeView(created);
        await manager.displayView(created, host.current);
      } catch (error) {
        if (cancelled) {
          return;
        }
        // A model the kernel does not have is the ordinary case above rather than something broken,
        // and the only way ipywidgets says so is the message it throws with.
        if (error instanceof Error && error.message === 'widget model not found') {
          setFailure(MISSING_MESSAGE);
          return;
        }
        console.error(`Could not display the widget ${modelId}:`, error);
        setFailure('This widget could not be displayed; the browser console has the reason.');
      }
    })();

    return () => {
      cancelled = true;
      dismiss?.();
    };
  }, [widgets, modelId]);

  return (
    <>
      {failure && <p>{failure}</p>}
      {/* Lumino attaches the view here, so nothing React renders may live inside it. */}
      <div ref={host} />
    </>
  );
};

export default WidgetRenderer;
