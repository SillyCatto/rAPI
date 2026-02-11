/**
 * messaging.ts — Helpers for postMessage communication between
 * the webview (React) and the extension host.
 */

import type { ExtensionMessage, WebviewMessage } from "../types";

// VS Code API handle — acquired once and cached
interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

let _vscode: VsCodeApi | undefined;

function getVsCodeApi(): VsCodeApi {
  if (!_vscode) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _vscode = (window as any).acquireVsCodeApi();
  }
  return _vscode!;
}

/** Send a typed message from the webview to the extension host. */
export function postToExtension(msg: WebviewMessage): void {
  getVsCodeApi().postMessage(msg);
}

/** Subscribe to messages from the extension host. Returns an unsubscribe fn. */
export function onExtensionMessage(
  handler: (msg: ExtensionMessage) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    handler(event.data as ExtensionMessage);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
