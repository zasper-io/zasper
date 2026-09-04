/**
 * ipywidgets' Output widget: a piece of a cell's output area that a widget holds instead.
 *
 * This is a replacement for `@jupyter-widgets/output` rather than a copy of it. That package
 * publishes no browser bundle, so unlike bqplot and the rest it cannot be fetched from the CDN when a
 * notebook first names it; and its own view draws its outputs through a `@jupyterlab/rendermime`,
 * which is JupyterLab's output machinery and not this notebook's. What it is, though, is two traits —
 * `outputs`, the outputs to show, and `msg_id`, the request whose output to take — so a view over the
 * notebook's own output components is a smaller thing than either.
 *
 * The taking is not done here: which messages belong to this widget has to be decided as they arrive,
 * before the cell shows them, and a model is built over awaits. The kernel session asks
 * [widgetBridge.ts](./widgetBridge.ts), which watches `msg_id` go by; what arrives here is the
 * messages it claimed, in order, through `addMessage`.
 */
import { DOMWidgetModel, DOMWidgetView } from '@jupyter-widgets/base';
import { createRoot, type Root } from 'react-dom/client';

import type { ICellOutput } from '@/api';
import { OutputBundles } from '@/ide/editor/notebook/CellOutput';

import type { WidgetSource } from './WidgetRenderer';
import type { IWidgetKernelMessage, ZasperWidgetManager } from './widgetManager';

/** The module name the Output widget's models and views name themselves by. */
export const MODULE_NAME = '@jupyter-widgets/output';

/** The version of the Output widget protocol, which is the one ipywidgets 8 speaks. */
export const MODULE_VERSION = '1.0.0';

/** The fields of the iopub messages an Output widget holds, across all of their types. */
interface IOutputContent {
  name?: string;
  text?: string;
  data?: Record<string, string>;
  metadata?: Record<string, unknown>;
  execution_count?: number;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  /** clear_output only: whether to keep what is shown until there is something to replace it. */
  wait?: boolean;
}

/** The nbformat output an iopub message carries, or undefined for one that carries none. */
function asOutput(msgType: string, content: IOutputContent): ICellOutput | undefined {
  switch (msgType) {
    case 'stream':
      return { output_type: 'stream', name: content.name, text: content.text };
    case 'display_data':
      return { output_type: 'display_data', data: content.data, metadata: content.metadata };
    case 'execute_result':
      return {
        output_type: 'execute_result',
        data: content.data,
        metadata: content.metadata,
        execution_count: content.execution_count,
      };
    case 'error':
      return {
        output_type: 'error',
        ename: content.ename,
        evalue: content.evalue,
        traceback: content.traceback,
      };
    default:
      return undefined;
  }
}

export class OutputModel extends DOMWidgetModel {
  /**
   * Whether a `clear_output(wait=True)` is waiting for something to replace what is on screen.
   *
   * Not a trait: it is a message that has been seen rather than anything either side holds. This is
   * how a widget redrawn on every interaction — every `interact` — avoids blinking empty between the
   * clear and the new output.
   */
  private clearWaiting = false;

  defaults() {
    return {
      ...super.defaults(),
      _model_name: 'OutputModel',
      _view_name: 'OutputView',
      _model_module: MODULE_NAME,
      _view_module: MODULE_NAME,
      _model_module_version: MODULE_VERSION,
      _view_module_version: MODULE_VERSION,
      msg_id: '',
      outputs: [],
    };
  }

  /** Folds one of the messages this widget captured into what it shows. */
  addMessage(message: IWidgetKernelMessage): void {
    const msgType = message.header.msg_type;
    const content = (message.content ?? {}) as IOutputContent;

    if (msgType === 'clear_output') {
      if (content.wait) {
        this.clearWaiting = true;
      } else {
        this.clearWaiting = false;
        this.setOutputs([]);
      }
      return;
    }

    const output = asOutput(msgType, content);
    if (!output) {
      return;
    }

    const outputs = this.clearWaiting ? [] : [...((this.get('outputs') ?? []) as ICellOutput[])];
    this.clearWaiting = false;

    const last = outputs[outputs.length - 1];
    // Streams arrive a line — sometimes a character — at a time, so a loop that prints would leave a
    // hundred separate outputs behind rather than the block of text it looked like.
    if (
      output.output_type === 'stream' &&
      last?.output_type === 'stream' &&
      last.name === output.name
    ) {
      outputs[outputs.length - 1] = { ...last, text: (last.text ?? '') + output.text };
    } else {
      outputs.push(output);
    }
    this.setOutputs(outputs);
  }

  /**
   * The kernel is told as well as the view: `outputs` is documented as what the frontend captured, so
   * `out.outputs` in Python reads back what is on screen, and a saved notebook reopened shows it.
   */
  private setOutputs(outputs: ICellOutput[]): void {
    this.set('outputs', outputs);
    this.save_changes();
  }
}

export class OutputView extends DOMWidgetView {
  private root?: Root;

  /**
   * Where a widget displayed inside this one goes for its runtime: the manager that owns this model,
   * which by definition has it already.
   */
  private readonly source: WidgetSource = {
    manager: () => Promise.resolve(this.model.widget_manager as ZasperWidgetManager),
  };

  render(): void {
    super.render();
    this.el.classList.add('jp-OutputArea', 'zasper-output-widget');
    this.root = createRoot(this.el);
    this.model.on('change:outputs', this.draw, this);
    this.draw();
  }

  remove(): unknown {
    this.model.off('change:outputs', this.draw, this);
    const root = this.root;
    this.root = undefined;
    // React will not have a root unmounted from inside a render, and this is called from one: the
    // cell holding the widget is being re-rendered, or the notebook is going away.
    queueMicrotask(() => root?.unmount());
    return super.remove();
  }

  private draw(): void {
    const outputs = (this.model.get('outputs') ?? []) as ICellOutput[];
    this.root?.render(<OutputBundles outputs={outputs} widgets={this.source} />);
  }
}
