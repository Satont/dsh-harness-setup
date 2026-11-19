/**
 * Server half of the baked-in live view: an authenticated localhost WS proxy
 * over agent-browser's per-session JPEG viewport stream, plus a tiny session
 * inventory endpoint the panel consumes.
 *
 * Design notes:
 * - No raw ports are exposed. Browsers talk ONLY to the DSH web server
 *   (same-origin); this module dials 127.0.0.1:<streamPort> itself.
 * - Frames flow with ack pacing and a conservative fps cap so a hidden panel
 *   never floods the machine; input forwarding is opt-in per connection
 *   (?input=1) AND gated on config.takeoverEnabled — read-only by default.
 *
 * @module dsh-agent-browser/panel
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { SessionRegistry } from "dsh-agent-browser-core";
export interface PanelConfig {
    autoOpenPanel: boolean;
    /** Optional live counters surfaced in the inventory payload (§6 instrumentation). */
    metrics?: () => Record<string, number>;
    /** Forward human pointer/keyboard input while takeover is held. Default false. */
    takeoverEnabled?: boolean;
    /** Cap for frames delivered to one panel client. Default 12. */
    maxFps?: number;
}
interface WebServerLike {
    register(route: {
        kind: "exact" | "prefix";
        path: string;
        handler: (req: IncomingMessage, res: import("node:http").ServerResponse) => void | Promise<void>;
    }): () => void;
    registerUpgrade(route: {
        path: string;
        handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;
    }): () => void;
}
/**
 * Mount the panel's HTTP + upgrade routes onto the host web server.
 * @returns disposer removing both routes and closing live proxies.
 */
export declare function mountPanel(ctx: unknown, webServer: WebServerLike, registry: SessionRegistry, config: PanelConfig): () => void;
export {};
