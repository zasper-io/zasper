/** The one change that turns `before` into `after`: what lies between their common start and end. */
export function changeBetween(before: string, after: string) {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) {
    start++;
  }
  let end = 0;
  while (
    end < shorter - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  ) {
    end++;
  }
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}
