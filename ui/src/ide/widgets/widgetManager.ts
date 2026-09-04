import * as base from '@jupyter-widgets/base';
import * as controls from '@jupyter-widgets/controls';
import { ManagerBase } from '@jupyter-widgets/base-manager';
import { MessageLoop } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';

// A widget's view is a Lumino widget, and both ipywidgets' own CSS and the libraries built on it
// assume the two rules in here: `position: relative`, which is what a bqplot figure's absolutely
// positioned background sizes itself against — without it the background takes the size of the
// notebook's output area and the plot overflows it — and `lm-mod-hidden`, which is how a widget that
// has been asked to hide itself does so.
import '@lumino/widgets/style/widget.css';
import '@jupyter-widgets/controls/css/widgets.css';

import { createCdnLoader, WidgetModuleLoader } from './cdnLoader';
import * as output from './outputWidget';
import { OutputModel } from './outputWidget';

/**
 * The message types widgets send: a comm's open, update and close, and the question a page that has
 * been reloaded asks about the comms already there.
 */
export type WidgetMessageType = 'comm_open' | 'comm_msg' | 'comm_close' | 'comm_info_request';

/** How long to wait for the list of the kernel's widget comms before deciding there is none. */
const COMM_INFO_TIMEOUT_MS = 4000;

/**
 * Sends one comm message to the kernel, and answers with the `msg_id` it went out under — which is
 * what the kernel's replies to it will carry, and so how they are recognised on the way back.
 */
export type SendComm = (
  msgType: WidgetMessageType,
  content: unknown,
  metadata: unknown,
  buffers: (ArrayBuffer | ArrayBufferView)[]
) => string;

/**
 * A kernel message, as far as widgets are concerned, with its buffers already decoded.
 *
 * Comm messages are addressed to a comm rather than to a cell, and the rest are here because a widget
 * waits on them: a model that has sent an update sends no other until the kernel reports itself idle
 * again.
 */
export interface IWidgetKernelMessage {
  header: { msg_type: string };
  parent_header?: { msg_id?: string };
  metadata?: unknown;
  content?: {
    comm_id?: string;
    target_name?: string;
    execution_state?: string;
    [key: string]: unknown;
  };
  buffers?: ArrayBuffer[];
  channel?: string;
}

/** What a comm needs of the kernel: somewhere to send, and somewhere to be answered. */
interface ICommChannel {
  send: SendComm;
  /** Registers the handlers for the messages answering the request with that id. */
  expect(msgId: string, callbacks: base.ICallbacks | undefined): void;
}

/**
 * One comm from the frontend's side: a widget model's channel to the Python object it mirrors.
 *
 * Messages go out through the notebook's websocket and come back in through `handleMsg`, which is
 * where the manager hands the ones addressed to this comm id.
 */
class KernelComm implements base.IClassicComm {
  private msgHandler?: (msg: IWidgetKernelMessage) => void;
  private closeHandler?: (msg: IWidgetKernelMessage) => void;

  constructor(
    readonly comm_id: string,
    readonly target_name: string,
    private readonly channel: ICommChannel
  ) {}

  open(
    data: unknown,
    callbacks?: base.ICallbacks,
    metadata?: unknown,
    buffers?: ArrayBuffer[] | ArrayBufferView[]
  ): string {
    return this.dispatch(
      'comm_open',
      { comm_id: this.comm_id, target_name: this.target_name, data },
      callbacks,
      metadata,
      buffers
    );
  }

  send(
    data: unknown,
    callbacks?: base.ICallbacks,
    metadata?: unknown,
    buffers?: ArrayBuffer[] | ArrayBufferView[]
  ): string {
    return this.dispatch('comm_msg', { comm_id: this.comm_id, data }, callbacks, metadata, buffers);
  }

  close(
    data?: unknown,
    callbacks?: base.ICallbacks,
    metadata?: unknown,
    buffers?: ArrayBuffer[] | ArrayBufferView[]
  ): string {
    return this.dispatch(
      'comm_close',
      { comm_id: this.comm_id, data: data ?? {} },
      callbacks,
      metadata,
      buffers
    );
  }

  on_msg(callback: (msg: IWidgetKernelMessage) => void): void {
    this.msgHandler = callback;
  }

  on_close(callback: (msg: IWidgetKernelMessage) => void): void {
    this.closeHandler = callback;
  }

  handleMsg(msg: IWidgetKernelMessage): void {
    this.msgHandler?.(msg);
  }

  handleClose(msg: IWidgetKernelMessage): void {
    this.closeHandler?.(msg);
  }

  private dispatch(
    msgType: WidgetMessageType,
    content: unknown,
    callbacks: base.ICallbacks | undefined,
    metadata: unknown,
    buffers: ArrayBuffer[] | ArrayBufferView[] | undefined
  ): string {
    const msgId = this.channel.send(msgType, content, metadata, buffers ?? []);
    this.channel.expect(msgId, callbacks);
    return msgId;
  }
}

/** The message type of the comm the kernel opens for a widget, as ManagerBase types it. */
type CommOpenMsg = Parameters<ManagerBase['handle_comm_open']>[1];

/**
 * The widget manager for one notebook: the registry of live widget models, and the comms they talk to
 * the kernel over.
 *
 * ipywidgets' own models and views are bundled (`@jupyter-widgets/base` and `controls`, which is
 * every widget in ipywidgets itself); anything else — bqplot, ipyleaflet, ipyvolume — is fetched from
 * the CDN by name and version when a widget of it first turns up. See createCdnLoader.
 */
export class ZasperWidgetManager extends ManagerBase {
  private readonly loader: WidgetModuleLoader = createCdnLoader({
    '@jupyter-widgets/base': base,
    '@jupyter-widgets/controls': controls,
    // Not on the CDN, and not what ipywidgets ships either: see outputWidget.tsx.
    [output.MODULE_NAME]: output,
  });
  private readonly comms = new Map<string, KernelComm>();
  /** Handlers waiting on the answer to a message, by the id of the message they answer. */
  private readonly pending = new Map<string, base.ICallbacks>();
  private readonly views = new Set<base.DOMWidgetView>();
  /** The messages handled so far, so that the next one waits for them. See handleKernelMessage. */
  private handling: Promise<void> = Promise.resolve();
  /** The one ask for the widgets the kernel already had. See restore. */
  private restoring?: Promise<void>;

  private readonly channel: ICommChannel;

  constructor(sendComm: SendComm) {
    super();
    this.channel = {
      send: sendComm,
      expect: (msgId, callbacks) => {
        if (callbacks) {
          this.pending.set(msgId, callbacks);
        }
      },
    };
    window.addEventListener('resize', this.resizeViews);
  }

  /**
   * Folds a kernel message into the widget state it belongs to, after every message before it.
   *
   * One at a time, and in order, because building a model is not instant — its state names the models
   * it refers to, and the library it belongs to may still be on its way from the CDN — while the
   * update that fills a figure with data follows its comm_open by a fraction of a millisecond.
   * Handled as it arrived, that update would be delivered to a comm whose model is not yet listening
   * on it, and a plot would come up empty.
   */
  handleKernelMessage(msg: IWidgetKernelMessage): Promise<void> {
    return this.after(() => this.handle(msg), `handle a ${msg.header.msg_type} for a widget`);
  }

  /**
   * Gives an Output widget one of the messages it is capturing, in its turn among the widget messages
   * — a widget can still be being built when the output it is to hold arrives.
   */
  addToOutputWidget(modelId: string, msg: IWidgetKernelMessage): Promise<void> {
    return this.after(async () => {
      const model = await this.get_model(modelId);
      if (!(model instanceof OutputModel)) {
        throw new Error('it is not an output widget');
      }
      model.addMessage(msg);
    }, `put a ${msg.header.msg_type} in the widget ${modelId}`);
  }

  /**
   * Picks up the widgets the kernel already has, which is what a reloaded page finds: a widget lives
   * in the kernel, and the comm_open that would have introduced it went to the page before this one.
   * Asked once, and answered by ipywidgets over a comm of its own; a kernel with nothing to say —
   * one that has never imported ipywidgets — closes that comm, which is not a failure.
   */
  restore(): Promise<void> {
    return (this.restoring ??= this._loadFromKernel().catch((error) => {
      console.error('Could not read the widgets the kernel already had:', error);
    }));
  }

  /** Queues work behind everything handled so far, and reports rather than throws when it fails. */
  private after(work: () => Promise<void>, what: string): Promise<void> {
    this.handling = this.handling.then(() =>
      work().catch((error) => {
        // One message going wrong is not the end of the queue behind it.
        console.error(`Could not ${what}:`, error);
      })
    );
    return this.handling;
  }

  private async handle(msg: IWidgetKernelMessage): Promise<void> {
    const commId = msg.content?.comm_id;

    switch (msg.header.msg_type) {
      case 'comm_open':
        // Only widgets: a kernel opens comms for other things too, and ipywidgets' own control comm
        // is opened from this side rather than the kernel's.
        if (commId && msg.content?.target_name === this.comm_target_name) {
          await this.openWidgetComm(commId, msg);
        }
        break;

      case 'comm_msg':
        if (commId) {
          this.comms.get(commId)?.handleMsg(msg);
        }
        break;

      case 'comm_close':
        if (commId) {
          const comm = this.comms.get(commId);
          this.comms.delete(commId);
          comm?.handleClose(msg);
        }
        break;
    }

    this.answerPending(msg);
  }

  /** Attaches a view to the page, so that it draws itself and learns its size. */
  async displayView(view: base.DOMWidgetView, el: HTMLElement): Promise<void> {
    Widget.attach(view.luminoWidget, el);
    this.views.add(view);
    view.once('remove', () => this.views.delete(view));
  }

  /**
   * Takes a view off the page and lets go of it.
   *
   * Lumino refuses to detach a widget whose node has left the document, and that is exactly the state
   * React leaves behind: it removes the output it was attached to before running the cleanup that
   * disposes the view. Unflagging it first keeps that refusal — a throw, in a React cleanup, so one
   * that blanks the whole IDE — from turning re-running a cell into a crash.
   */
  removeView(view: base.DOMWidgetView): void {
    const { luminoWidget } = view;
    if (luminoWidget.isAttached && !luminoWidget.node.isConnected) {
      luminoWidget.clearFlag(Widget.Flag.IsAttached);
    }
    view.remove();
  }

  /** Lets go of every model and view, for a notebook whose kernel or tab has gone. */
  dispose(): void {
    window.removeEventListener('resize', this.resizeViews);
    // Dead comms first: closing a model would otherwise send a comm_close to a kernel that is not
    // listening, or not there.
    this.disconnect();
    this.comms.clear();
    this.pending.clear();
    // Views before models, and through removeView: closing a model removes its views too, but from
    // inside a promise where the detach Lumino refuses would surface as nothing but a console error.
    for (const view of [...this.views]) {
      this.removeView(view);
    }
    void this.clear_state();
  }

  protected async loadClass(
    className: string,
    moduleName: string,
    moduleVersion: string
  ): Promise<typeof base.WidgetModel | typeof base.WidgetView> {
    const module = (await this.loader(moduleName, moduleVersion)) as Record<string, unknown>;
    const widgetClass = module[className];
    if (!widgetClass) {
      throw new Error(`${moduleName}@${moduleVersion} has no widget class named ${className}`);
    }
    return widgetClass as typeof base.WidgetModel | typeof base.WidgetView;
  }

  protected async _create_comm(
    targetName: string,
    commId?: string,
    data?: unknown,
    metadata?: unknown,
    buffers?: ArrayBuffer[] | ArrayBufferView[]
  ): Promise<base.IClassicComm> {
    const comm = new KernelComm(commId ?? base.uuid(), targetName, this.channel);
    this.comms.set(comm.comm_id, comm);
    // Data means this is a new comm rather than one being picked up again, and a new one has to be
    // opened on the kernel's side before anything can be sent over it.
    if (data !== undefined) {
      comm.open(data, undefined, metadata, buffers);
    }
    return comm;
  }

  /**
   * The kernel's open widget comms, keyed by comm id.
   *
   * Only reached for a kernel too old to answer `restore`'s question the shorter way (ipywidgets 7.6
   * and before), and answered with nothing rather than an error when the kernel does not reply: there
   * being no widgets is the ordinary case, and a notebook must not wait on it.
   */
  protected _get_comm_info(): Promise<{}> {
    return new Promise((resolve) => {
      const msgId = this.channel.send(
        'comm_info_request',
        { target_name: this.comm_target_name },
        {},
        []
      );
      const timer = window.setTimeout(() => resolve({}), COMM_INFO_TIMEOUT_MS);
      this.channel.expect(msgId, {
        shell: {
          comm_info_reply: (msg) => {
            window.clearTimeout(timer);
            resolve((msg.content as { comms?: {} }).comms ?? {});
          },
        },
      });
    });
  }

  private async openWidgetComm(commId: string, msg: IWidgetKernelMessage): Promise<void> {
    const comm = new KernelComm(commId, this.comm_target_name, this.channel);
    this.comms.set(commId, comm);
    try {
      await this.handle_comm_open(comm, msg as unknown as CommOpenMsg);
    } catch (error) {
      // The widget is lost, but the notebook is not: its other cells and its kernel carry on, and the
      // view left waiting on the model says so where the output would have been.
      console.error(`Could not build the widget model ${commId}:`, error);
    }
  }

  /**
   * Hands a message to whoever is waiting on the request it answers.
   *
   * This is how a widget learns its update has been dealt with: a model holds back further updates
   * until the kernel reports itself idle again, so without this a slider moves once and then stops.
   */
  private answerPending(msg: IWidgetKernelMessage): void {
    const requestId = msg.parent_header?.msg_id;
    const callbacks = requestId ? this.pending.get(requestId) : undefined;
    if (!requestId || !callbacks) {
      return;
    }

    const msgType = msg.header.msg_type;
    if (msg.channel === 'iopub') {
      callbacks.iopub?.[msgType]?.(msg as never);
      if (msgType === 'status' && msg.content?.execution_state === 'idle') {
        // Idle is the last thing said about a request, so nothing else can arrive for it.
        this.pending.delete(requestId);
      }
    } else if (msg.channel === 'stdin') {
      callbacks.input?.(msg as never);
    } else {
      callbacks.shell?.[msgType]?.(msg as never);
    }
  }

  /**
   * A widget draws itself to the size it was given, and a notebook's outputs change width whenever
   * the window does — so views are told to measure again, which is what a Lumino widget listens for.
   */
  private readonly resizeViews = (): void => {
    for (const view of this.views) {
      MessageLoop.postMessage(view.luminoWidget, Widget.ResizeMessage.UnknownSize);
    }
  };
}
