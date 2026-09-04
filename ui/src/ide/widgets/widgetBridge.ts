import type { IWidgetKernelMessage, SendComm, ZasperWidgetManager } from './widgetManager';

/**
 * The message types an Output widget can hold (see outputWidget.tsx). Listed here rather than
 * imported from there so that deciding a message is not one costs no widget code at all.
 */
const OUTPUT_MESSAGE_TYPES = new Set([
  'stream',
  'display_data',
  'execute_result',
  'error',
  'clear_output',
]);

/**
 * Owns the widget runtime for one notebook's kernel, and puts off loading it until a widget turns up.
 *
 * ipywidgets and the libraries built on it are megabytes of JavaScript that most notebooks never need,
 * so the manager and everything it imports are a chunk of their own, fetched when the kernel first
 * opens a widget comm or a saved widget output asks to be drawn. Messages that arrive while it is on
 * its way are kept and replayed in order — a widget's first state update follows its comm_open
 * immediately, and losing it leaves a plot with no data in it.
 */
export class WidgetBridge {
  private loaded?: ZasperWidgetManager;
  private loading?: Promise<ZasperWidgetManager>;
  private queued: ((manager: ZasperWidgetManager) => void)[] = [];
  private disposed = false;
  /** Whether the kernel has opened a widget comm on this socket. See manager. */
  private live = false;
  /** Which widget is capturing a request's output, by the id of the request. See captureOutput. */
  private readonly captures = new Map<string, string>();

  constructor(private readonly sendComm: SendComm) {}

  /**
   * Whether a message is any of a widget's business: the comm messages widgets talk over, the answer
   * to what comms a kernel has, and the statuses that answer an update, which is how a model learns
   * one of its own has been dealt with.
   */
  static handles(msgType: string): boolean {
    return (
      msgType === 'comm_open' ||
      msgType === 'comm_msg' ||
      msgType === 'comm_close' ||
      msgType === 'comm_info_reply' ||
      msgType === 'status'
    );
  }

  handleKernelMessage(message: IWidgetKernelMessage): void {
    if (this.disposed) {
      return;
    }
    if (message.header.msg_type === 'comm_open') {
      this.live = true;
    }
    // Before the first comm_open there is no widget for a status or an update to reach, and no reason
    // to fetch a runtime for them.
    if (!this.loading && message.header.msg_type !== 'comm_open') {
      return;
    }
    if (message.header.msg_type === 'comm_msg') {
      this.noteCapture(message);
    }
    this.deliver((manager) => void manager.handleKernelMessage(message));
  }

  /**
   * Hands a message to the Output widget capturing the request it belongs to, and says whether one
   * did — in which case the cell that ran the request shows nothing for it.
   */
  captureOutput(message: IWidgetKernelMessage): boolean {
    if (this.disposed || !OUTPUT_MESSAGE_TYPES.has(message.header.msg_type)) {
      return false;
    }
    const requestId = message.parent_header?.msg_id;
    const modelId = requestId ? this.captures.get(requestId) : undefined;
    if (!modelId) {
      return false;
    }
    this.deliver((manager) => void manager.addToOutputWidget(modelId, message));
    return true;
  }

  /**
   * The manager, once its code has arrived and it has caught up with whatever widgets the kernel had
   * before this page did.
   */
  manager(): Promise<ZasperWidgetManager> {
    const loading = this.load();
    // A kernel that has opened a comm here has introduced its widgets itself; only one that was
    // already running when the page loaded has anything left to tell.
    if (this.disposed || this.live) {
      return loading;
    }
    return loading.then(async (manager) => {
      await manager.restore();
      return manager;
    });
  }

  dispose(): void {
    this.disposed = true;
    this.queued = [];
    this.captures.clear();
    this.loaded?.dispose();
  }

  /**
   * Notes an Output widget being told which request's output to capture, or told to stop.
   *
   * Read here, as the message arrives, rather than in the manager: a model is built over awaits, and
   * the output to capture follows the message asking for it by a fraction of a millisecond — by the
   * time there was a model to ask, the cell would have shown it. `msg_id` is the trait ipywidgets'
   * Output widget carries for exactly this, and the only widget trait of that name.
   */
  private noteCapture(message: IWidgetKernelMessage): void {
    const commId = message.content?.comm_id;
    const data = message.content?.data as
      | { method?: string; state?: Record<string, unknown> }
      | undefined;
    const state = data?.method === 'update' ? data.state : undefined;
    if (!commId || !state || !('msg_id' in state)) {
      return;
    }

    // A widget captures one request at a time, and stops when its msg_id goes back to empty.
    for (const [requestId, owner] of this.captures) {
      if (owner === commId) {
        this.captures.delete(requestId);
      }
    }
    const requestId = state.msg_id;
    if (typeof requestId === 'string' && requestId !== '') {
      this.captures.set(requestId, commId);
    }
  }

  /** Does something with the manager, in order, whether or not its code has arrived yet. */
  private deliver(action: (manager: ZasperWidgetManager) => void): void {
    if (this.loaded) {
      action(this.loaded);
      return;
    }
    this.queued.push(action);
    void this.load();
  }

  private load(): Promise<ZasperWidgetManager> {
    return (this.loading ??= import('./widgetManager').then(({ ZasperWidgetManager }) => {
      const manager = new ZasperWidgetManager(this.sendComm);
      if (this.disposed) {
        manager.dispose();
        return manager;
      }
      this.loaded = manager;
      const queued = this.queued;
      this.queued = [];
      for (const action of queued) {
        action(manager);
      }
      return manager;
    }));
  }
}
