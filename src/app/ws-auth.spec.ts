import { WS_BEARER_PREFIX, WS_PROTOCOL, base64urlToken, wsProtocols } from './ws-auth';

/**
 * These constants and this encoding are half of a cross-language contract; the
 * other half is internal/gateway/wsauth.go. If they drift, the gateway rejects
 * the upgrade and the user sees a bare "connection closed" with no clue why —
 * so the wire format is pinned here rather than just exercised.
 */
describe('ws-auth: the wire contract with the gateway', () => {
  it('pins the subprotocol names', () => {
    expect(WS_BEARER_PREFIX).toBe('base64url.bearer.authorization.kubeswift.io.');
    expect(WS_PROTOCOL).toBe('kubeswift.io');
  });

  it('encodes base64url with no padding', () => {
    // "abcd" is the interesting case: standard base64 pads it.
    expect(base64urlToken('abcd')).toBe('YWJjZA');
    expect(base64urlToken('abcd')).not.toContain('=');
  });

  it('never emits a character illegal in an HTTP token', () => {
    // A subprotocol must be an RFC 7230 token: '+', '/' and '=' are separators
    // and would be rejected (or silently truncated) by the server.
    //
    // These two inputs are chosen because standard base64 maps them onto '+'
    // and '/' respectively.
    for (const raw of ['ÿï¾', 'ûÿ¿', 'a'.repeat(61)]) {
      const enc = base64urlToken(raw);
      expect(enc).not.toContain('+');
      expect(enc).not.toContain('/');
      expect(enc).not.toContain('=');
    }
  });

  it('round-trips a realistic JWT', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.eyJzdWIiOiJ1c2VyQGV4YW1wbGUuY29tIn0.sig-x_y+z/w';
    const enc = base64urlToken(jwt);
    const back = atob(enc.replace(/-/g, '+').replace(/_/g, '/'));
    expect(back).toBe(jwt);
  });

  it('handles a non-ASCII token as UTF-8 rather than throwing', () => {
    // btoa() throws on a raw string with code points > 255, so the TextEncoder
    // step is load-bearing, not decoration.
    expect(() => base64urlToken('tökén-ünïcode-✓')).not.toThrow();
  });

  it('always offers WS_PROTOCOL so the server can select one', () => {
    // A browser fails the connection outright if it offers subprotocols and the
    // server selects none. The gateway only ever echoes WS_PROTOCOL.
    expect(wsProtocols('t')).toContain(WS_PROTOCOL);
    expect(wsProtocols(null)).toEqual([WS_PROTOCOL]);
    expect(wsProtocols('')).toEqual([WS_PROTOCOL]);
  });

  it('puts the bearer first and never sends a bare token', () => {
    const p = wsProtocols('secret');
    expect(p[0].startsWith(WS_BEARER_PREFIX)).toBeTruthy();
    expect(p).not.toContain('secret');
  });
});
