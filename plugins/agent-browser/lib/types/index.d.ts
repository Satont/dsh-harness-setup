/**
 * dsh-agent-browser — the DSH bundle half of the native agent-browser tool
 * suite. Registers the model-facing browser_* tools over the
 * dsh-agent-browser-core driver seam, plus the prompt ladder that teaches the
 * model the find-before-snapshot / batch-before-repeat / eval-last discipline.
 *
 * The live panel (WS proxy route + client-ui slot) mounts from this same
 * bundle when the host provides a webServer service; headless profiles get
 * the tools without any UI wiring.
 *
 * @module dsh-agent-browser
 */
import z from "@deepseek-ai/schemastery";
export { mountPanel } from "./panel.ts";
export type { PanelConfig } from "./panel.ts";
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "browser";
/** Services required at load time; webServer is read lazily so headless profiles work. */
export declare const inject: string[];
/** Plugin configuration; overrides belong in the profile cordis.patch.yml. */
export interface Config {
    /** Auto-open the live panel on first browser_* call (web profiles). Default true. */
    autoOpenPanel?: boolean;
    /** Daemon idle timeout in minutes; the daemon exits after this much inactivity. Default 15. */
    idleTimeoutMinutes?: number;
    /**
     * Base RPC timeout budget in ms; the per-operation budgets below scale from
     * it (nav 1.5×, snapshot/shot 1×, act 3×, read 0.75×, eval 0.5×). Default
     * 60000 — which reproduces the historical fixed budgets exactly. Also
     * inherited by every driver-level call that does not set its own timeout.
     */
    defaultTimeoutMs?: number;
    /** Extra Chromium launch args (comma/newline separated for YAML friendliness). */
    launchArgs?: string;
    /** Restrict navigations to these domains when non-empty. */
    allowedDomains?: string[];
    /** Redact cookie values in browser_get output. Default true. */
    cookiesRedacted?: boolean;
    /** Allow browser_eval page-JS execution. Default false (approval-gated tier). */
    allowEval?: boolean;
    /** Enable the panel's human-takeover input forwarding. Default false. */
    allowTakeover?: boolean;
    /** Launch the browser headed instead of headless. Default false. */
    headed?: boolean;
    /** Explicit path to the agent-browser launcher binary. */
    binaryPath?: string;
}
export declare const Config: z<Config>;
/**
 * Register the browser tool surface.
 * @param ctx - cordis context (tools + systemPrompt required; webServer optional).
 * @param rawConfig - resolved plugin configuration.
 */
export declare function apply(ctx: import("@deepseek-ai/cordis").Context, rawConfig: Config): void;
