import { getCurrentWindow } from "@tauri-apps/api/window";
import { safeLocalStorage } from "../storage";

/** Label of the webview window this module is running in (e.g. "main"). */
let WINDOW_LABEL = "unknown";
try {
  if (typeof window !== "undefined") {
    WINDOW_LABEL = getCurrentWindow().label;
  }
} catch {
  // getCurrentWindow throws outside a Tauri webview (e.g. plain browser dev)
}

/**
 * Lightweight, runtime-toggleable debug logging for the AI / STT request paths.
 *
 * Turn on/off from the DevTools console (no rebuild needed):
 *   localStorage.setItem("pluely_debug", "true")   // enable
 *   localStorage.removeItem("pluely_debug")         // disable
 *
 * When enabled, request/response details are printed to the console with the
 * API key redacted and large base64 blobs (images/audio) truncated.
 */

const DEBUG_STORAGE_KEY = "pluely_debug";

declare global {
  interface Window {
    __pluelyDebug?: boolean;
    pluelyDebug?: (on?: boolean) => void;
  }
}

export function isDebugEnabled(): boolean {
  try {
    // Explicit per-window override (set via pluelyDebug(true|false)).
    if (typeof window !== "undefined" && typeof window.__pluelyDebug === "boolean") {
      return window.__pluelyDebug;
    }
    // Explicit persisted override.
    const stored = safeLocalStorage.getItem(DEBUG_STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
    // Default: ON in dev builds (npm run tauri dev), OFF in production.
    return !!(import.meta as any).env?.DEV;
  } catch {
    return false;
  }
}

/**
 * Expose a reliable per-window toggle and print a one-time banner so you can
 * confirm this window is running the debug-instrumented code. Each Pluely
 * webview window has its own console + localStorage, so call `pluelyDebug(true)`
 * in the console of the window that actually makes the AI/STT request (the main
 * chat/overlay window), not the settings window.
 */
if (typeof window !== "undefined" && !window.pluelyDebug) {
  window.pluelyDebug = (on: boolean = true) => {
    window.__pluelyDebug = on;
    try {
      safeLocalStorage.setItem(DEBUG_STORAGE_KEY, on ? "true" : "false");
    } catch {}
    // eslint-disable-next-line no-console
    console.info(
      `[pluely] debug logging ${
        on ? "ENABLED" : "disabled"
      } for window "${WINDOW_LABEL}"`
    );
  };

  // eslint-disable-next-line no-console
  console.info(
    `[pluely] debug helpers loaded in window "${WINDOW_LABEL}" — AI/STT logs are ON by default in dev (run pluelyDebug(false) to silence)`
  );
}

export function debugLog(...args: any[]): void {
  if (isDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.log(`[win:${WINDOW_LABEL}]`, ...args);
  }
}

const SENSITIVE_HEADER_KEYS = [
  "authorization",
  "x-api-key",
  "api-key",
  "xi-api-key",
  "ocp-apim-subscription-key",
];

function mask(secret: string): string {
  if (secret.length <= 8) return "***";
  return `${secret.slice(0, 4)}***${secret.slice(-2)}`;
}

/** Mask a header value, preserving any auth scheme prefix (Bearer/TOKEN/Basic). */
function maskHeaderValue(value: string): string {
  const m = value.match(/^(Bearer|TOKEN|Basic)\s+(.*)$/i);
  if (m) return `${m[1]} ${mask(m[2])}`;
  return mask(value);
}

export function redactHeaders(
  headers: Record<string, any> | undefined
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (
      SENSITIVE_HEADER_KEYS.includes(key.toLowerCase()) &&
      typeof value === "string"
    ) {
      out[key] = maskHeaderValue(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Mask secrets passed as query params (e.g. ?key=... or ?token=...). */
export function redactUrl(url: string): string {
  return url.replace(
    /([?&](?:key|token|api_key|apikey|access_token)=)[^&]+/gi,
    "$1***"
  );
}

/**
 * Deep-clone a value for logging, truncating any long string (e.g. base64
 * image/audio data) so the console stays readable.
 */
export function truncateForLog(value: any, maxLen = 200): any {
  if (typeof value === "string") {
    return value.length > maxLen
      ? `${value.slice(0, maxLen)}…[${value.length} chars]`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateForLog(item, maxLen));
  }
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const key in value) {
      out[key] = truncateForLog(value[key], maxLen);
    }
    return out;
  }
  return value;
}
