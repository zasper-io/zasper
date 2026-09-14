/**
 * Whether this browser believes it holds a session.
 *
 * The session itself is an HttpOnly cookie, which no script can see, so this only decides between
 * showing the IDE and the sign-in page. The server still answers 401 to a session that has expired or
 * been signed out, and the IDE then clears this and goes to sign in.
 */
const SIGNED_IN = 'zasper.signedIn';

/** Where earlier versions kept the session itself, readable by any script in the page. */
const OLD_TOKEN = 'token';

export function isSignedIn(): boolean {
  return localStorage.getItem(SIGNED_IN) !== null;
}

export function markSignedIn(): void {
  localStorage.setItem(SIGNED_IN, '1');
  localStorage.removeItem(OLD_TOKEN);
}

export function markSignedOut(): void {
  localStorage.removeItem(SIGNED_IN);
  localStorage.removeItem(OLD_TOKEN);
}
