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
 * Sanitize a header value for Node.js http module.
 * Node 18+ strictly validates headers — only allows characters in Latin-1 range.
 * Remove/replace anything outside the valid range.
 */
function sanitizeHeaderValue(value: string): string {
  // Convert to string, trim, and keep only valid HTTP header value chars
  // Valid chars: tab (0x09) and printable ASCII (0x20-0x7E) plus Latin-1 (0x80-0xFF)
  // Remove control characters and anything outside Latin-1
  let result = "";
  for (const char of String(value)) {
    const code = char.charCodeAt(0);
    // Allow tab, space through tilde, and extended Latin-1 (but not DEL 0x7F)
    if (
      code === 0x09 ||
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0x80 && code <= 0xff)
    ) {
      result += char;
    }
    // Skip invalid characters silently
  }
  return result.trim();
}

/**
 * Sanitize header name — should be valid HTTP token.
 */
function sanitizeHeaderName(name: string): string {
  // Trim whitespace and remove invalid characters
  return name.trim().replace(/[^a-zA-Z0-9!#$%&'*+.^_`|~-]/g, "");
}

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

  // Sanitize headers for Node.js http module compatibility
  const headers: Record<string, string> = {};
  if (resolved.headers) {
    for (const [key, value] of Object.entries(resolved.headers)) {
      // Skip empty, null, or undefined values
      if (value === null || value === undefined || value === "") {
        continue;
      }
      const sanitizedKey = sanitizeHeaderName(key);
      // Ensure value is a string and sanitize it
      const strValue = typeof value === "string" ? value : String(value);
      const sanitizedValue = sanitizeHeaderValue(strValue);
      if (sanitizedKey && sanitizedValue) {
        headers[sanitizedKey] = sanitizedValue;
      }
    }
  }
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
