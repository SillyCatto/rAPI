/**
 * Shared type definitions used by both the extension host and the webview.
 * Keep this file free of VS Code or React imports so it can be consumed by both sides.
 */

// ─── Domain models ───────────────────────────────────────────────────────────

export interface RequestSpec {
  id: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Collection {
  name: string;
  requests: RequestSpec[];
}

export interface Environment {
  name: string;
  values: Record<string, string>;
}

export interface RequestResult {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson?: any;
}

// ─── Webview ↔ Extension messages ────────────────────────────────────────────

export type WebviewMessage =
  | { type: "sendRequest"; payload: { request: RequestSpec; envName?: string } }
  | {
      type: "saveRequest";
      payload: { collectionName: string; request: RequestSpec };
    }
  | { type: "loadCollections" }
  | { type: "loadEnvironments" }
  | {
      type: "openRequest";
      payload: { collectionName: string; requestId: string };
    }
  | {
      type: "deleteRequest";
      payload: { collectionName: string; requestId: string };
    }
  | { type: "createCollection"; payload: { name: string } }
  | { type: "webviewReady" };

export type ExtensionMessage =
  | {
      type: "requestResult";
      payload: { result: RequestResult; requestId: string };
    }
  | { type: "requestError"; payload: { error: string; requestId: string } }
  | { type: "collectionsLoaded"; payload: { collections: Collection[] } }
  | { type: "environmentsLoaded"; payload: { environments: Environment[] } }
  | {
      type: "openRequestInEditor";
      payload: { request: RequestSpec; collectionName: string };
    }
  | { type: "warning"; payload: { message: string } }
  | { type: "themeColorsUpdated"; payload: { css: Record<string, string> } };
