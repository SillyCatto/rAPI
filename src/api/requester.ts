/**
 * requester.ts — Sends HTTP requests from the extension host (Node.js side)
 * to avoid CORS issues that would occur from the webview's browser context.
 *
 * Uses Node's built-in `http`/`https` modules for zero-dependency HTTP.
 */

import * as http from "http";
import * as https from "https";
import { URL } from "url";
import { Environment, RequestResult, RequestSpec } from "../types";

/** Maximum response body size we'll buffer (1 MB). */
const MAX_BODY_SIZE = 1_048_576;

/**
 * Replace `{{key}}` placeholders in a string using environment values.
 * Returns the resolved string and a list of any missing variable names.
 */
export function envSubstitute(
  input: string,
  env: Record<string, string>,
): { result: string; missingVars: string[] } {
  const missingVars: string[] = [];
  const result = input.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in env) {
      return env[key];
    }
    missingVars.push(key);
    return match; // leave placeholder as-is
  });
  return { result, missingVars };
}

/**
 * Apply environment substitution to all string fields of a request.
 */
function applyEnv(
  request: RequestSpec,
  env?: Environment,
): { resolved: RequestSpec; missingVars: string[] } {
  if (!env) {
    return { resolved: { ...request }, missingVars: [] };
  }

  const allMissing: string[] = [];

  const resolveStr = (s: string): string => {
    const { result, missingVars } = envSubstitute(s, env.values);
    allMissing.push(...missingVars);
    return result;
  };

  const resolved: RequestSpec = {
    ...request,
    url: resolveStr(request.url),
    headers: request.headers
      ? Object.fromEntries(
          Object.entries(request.headers).map(([k, v]) => [k, resolveStr(v)]),
        )
      : undefined,
    body: request.body ? resolveStr(request.body) : request.body,
  };

  // Deduplicate missing vars
  const unique = [...new Set(allMissing)];
  return { resolved, missingVars: unique };
}

/**
 * Send an HTTP request and return the result.
 * Runs entirely in the Node.js extension host — no CORS restrictions.
 */
export async function sendRequest(
  request: RequestSpec,
  env?: Environment,
): Promise<{ result: RequestResult; missingVars: string[] }> {
  const { resolved, missingVars } = applyEnv(request, env);

  const url = new URL(resolved.url);
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;

  const headers: Record<string, string> = { ...resolved.headers };
  if (resolved.body && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: resolved.method,
        headers,
        timeout: 30_000, // 30 second timeout
      },
      (res) => {
        const chunks: Buffer[] = [];
        let totalSize = 0;
        let truncated = false;

        res.on("data", (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize <= MAX_BODY_SIZE) {
            chunks.push(chunk);
          } else {
            truncated = true;
          }
        });

        res.on("end", () => {
          const durationMs = Date.now() - startTime;
          const bodyText = Buffer.concat(chunks).toString("utf-8");

          // Flatten response headers to Record<string,string>
          const responseHeaders: Record<string, string> = {};
          for (const [key, val] of Object.entries(res.headers)) {
            if (val !== undefined) {
              responseHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
            }
          }

          let bodyJson: any;
          try {
            bodyJson = JSON.parse(bodyText);
          } catch {
            // not JSON — that's fine
          }

          const result: RequestResult = {
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? "",
            durationMs,
            headers: responseHeaders,
            bodyText: truncated
              ? bodyText + "\n\n[Response truncated — exceeded 1 MB]"
              : bodyText,
            bodyJson,
          };

          resolve({ result, missingVars });
        });

        res.on("error", (err) => reject(err));
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("Request timed out after 30s"));
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (resolved.body) {
      req.write(resolved.body);
    }
    req.end();
  });
}
