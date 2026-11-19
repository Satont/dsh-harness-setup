/**
 * Cookie redaction policy. The daemon has been observed returning BOTH bare
 * arrays and `{ cookies: [...] }` wrappers depending on version — redact
 * every known cookie field wherever it appears. Unknown shapes pass through
 * untouched (the caller logs them), but arrays of cookie-like objects are
 * always covered.
 *
 * @module dsh-agent-browser/cookies
 */
export interface ArrayPayload {
    kind: "array";
    data: unknown[];
}
export interface WrapperPayload {
    kind: "wrapper";
    data: Record<string, unknown>;
}
export declare function redactCookiePayload(payload: unknown): ArrayPayload | WrapperPayload | undefined;
