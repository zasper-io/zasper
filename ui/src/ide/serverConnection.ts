import { serverAnswers } from '@/api';

let offline = false;
const listeners = new Set<(offline: boolean) => void>();

function setOffline(next: boolean): void {
  if (next !== offline) {
    offline = next;
    listeners.forEach((listener) => listener(next));
  }
}

/**
 * Tells listener whether the server has stopped answering, now and whenever that changes. Answers the
 * function that stops listening.
 */
export function watchServer(listener: (offline: boolean) => void): () => void {
  listeners.add(listener);
  listener(offline);
  return () => {
    listeners.delete(listener);
  };
}

/** Asks the server whether it is there, and tells everyone watching. */
export async function checkServer(): Promise<boolean> {
  const answered = await serverAnswers();
  setOffline(!answered);
  return answered;
}

/** Something connected to the server, so it is there. */
export function serverAnswered(): void {
  setOffline(false);
}
