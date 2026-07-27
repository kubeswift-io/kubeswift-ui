/**
 * WebSocket bearer transport, shared by the three raw-WS planes.
 *
 * A browser cannot set an Authorization header on a WebSocket, so the token
 * used to ride `?token=`. A query string is echoed by every access log on the
 * path — the UI's own nginx and any ingress in front of it — which put a live,
 * replayable ID token in front of anyone holding `pods/log` on the namespace,
 * plus every log shipper downstream. A subprotocol travels in a header
 * (Sec-WebSocket-Protocol), so it is not part of the URL and is not logged.
 *
 * The shape mirrors the Kubernetes apiserver's own convention for
 * `kubectl exec` over WebSocket.
 *
 * These constants MUST match internal/gateway/wsauth.go on the gateway side.
 */

export const WS_BEARER_PREFIX = 'base64url.bearer.authorization.kubeswift.io.';
export const WS_PROTOCOL = 'kubeswift.io';

/**
 * base64url encodes a token for use as a subprotocol value.
 *
 * A subprotocol has to be a valid HTTP token, so this is base64url WITHOUT
 * padding: `-` and `_` are legal token characters while `+`, `/` and `=` are
 * not. Getting this wrong does not fail loudly — the browser sends a
 * subprotocol the gateway cannot decode, the upgrade is rejected, and the user
 * sees a bare "connection closed".
 */
export function base64urlToken(token: string): string {
  const bytes = new TextEncoder().encode(token); // UTF-8, so non-ASCII survives
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * wsProtocols builds the subprotocol list for a raw-WS connection.
 *
 * WS_PROTOCOL is always offered, including when there is no token: a browser
 * fails the connection outright if it offers subprotocols and the server
 * selects none, and the gateway only ever echoes this one back — never the
 * bearer, which must not be reflected into a response.
 */
export function wsProtocols(token: string | null | undefined): string[] {
  if (!token) return [WS_PROTOCOL];
  return [`${WS_BEARER_PREFIX}${base64urlToken(token)}`, WS_PROTOCOL];
}
