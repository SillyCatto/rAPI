/**
 * RequestEditor.tsx — Left pane: method selector, URL, headers, body, send/save buttons.
 */

import React, { useCallback, useEffect, useState } from "react";
import type { Collection, Environment, RequestSpec } from "../types";
import { postToExtension } from "./messaging";

interface Props {
  /** Pre-populated request (e.g. when opening from sidebar). */
  activeRequest: RequestSpec | null;
  /** Name of the collection the active request belongs to. */
  activeCollectionName: string;
  collections: Collection[];
  environments: Environment[];
  sending: boolean;
  onSend: () => void;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

/** Postman-style verb colors */
const METHOD_COLORS: Record<string, string> = {
  GET: "#49cc90",
  POST: "#fca130",
  PUT: "#50e3c2",
  PATCH: "#d4a017",
  DELETE: "#f93e3e",
  OPTIONS: "#d63aff",
};

interface HeaderRow {
  key: string;
  value: string;
  enabled: boolean;
}

function newId(): string {
  return (
    "req-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

export const RequestEditor: React.FC<Props> = ({
  activeRequest,
  activeCollectionName,
  collections,
  environments,
  sending,
  onSend,
}) => {
  const [method, setMethod] = useState<RequestSpec["method"]>("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([
    { key: "", value: "", enabled: true },
  ]);
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [envName, setEnvName] = useState("");
  const [requestId, setRequestId] = useState(newId());

  // Sync from parent when a request is opened from the sidebar
  useEffect(() => {
    if (activeRequest) {
      setMethod(activeRequest.method);
      setUrl(activeRequest.url);
      setName(activeRequest.name);
      setBody(activeRequest.body ?? "");
      setRequestId(activeRequest.id);
      if (
        activeRequest.headers &&
        Object.keys(activeRequest.headers).length > 0
      ) {
        setHeaders([
          ...Object.entries(activeRequest.headers).map(([k, v]) => ({
            key: k,
            value: v,
            enabled: true,
          })),
          { key: "", value: "", enabled: true },
        ]);
      } else {
        setHeaders([{ key: "", value: "", enabled: true }]);
      }
    }
    if (activeCollectionName) {
      setCollectionName(activeCollectionName);
    }
  }, [activeRequest, activeCollectionName]);

  const parseHeaders = useCallback((): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const row of headers) {
      if (row.enabled && row.key.trim()) {
        result[row.key.trim()] = row.value;
      }
    }
    return result;
  }, [headers]);

  const buildSpec = useCallback(
    (): RequestSpec => ({
      id: requestId,
      name: name || `${method} request`,
      method,
      url,
      headers: parseHeaders(),
      body: body || null,
      updatedAt: new Date().toISOString(),
    }),
    [requestId, name, method, url, parseHeaders, body],
  );

  const handleSend = () => {
    const spec = buildSpec();
    postToExtension({
      type: "sendRequest",
      payload: { request: spec, envName: envName || undefined },
    });
    onSend();
  };

  const handleSave = () => {
    const targetCollection = collectionName || "default";
    const spec = buildSpec();
    postToExtension({
      type: "saveRequest",
      payload: { collectionName: targetCollection, request: spec },
    });
  };

  const handleNew = () => {
    setRequestId(newId());
    setName("");
    setMethod("GET");
    setUrl("");
    setHeaders([{ key: "", value: "", enabled: true }]);
    setBody("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="request-editor" onKeyDown={handleKeyDown}>
      {/* ── Request name (above verb bar) ── */}
      <div className="re-row">
        <input
          className="re-name"
          type="text"
          placeholder="Request name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* ── Top bar: method + URL + Send ── */}
      <div className="re-topbar">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as RequestSpec["method"])}
          className="re-method"
          style={{ color: METHOD_COLORS[method] ?? "inherit" }}
        >
          {METHODS.map((m) => (
            <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="re-url"
          type="text"
          placeholder="https://example.com/api"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="re-send-btn"
          onClick={handleSend}
          disabled={sending || !url}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      {/* ── Environment selector ── */}
      <div className="re-row">
        <label className="re-label">Environment</label>
        <select
          value={envName}
          onChange={(e) => setEnvName(e.target.value)}
          className="re-env-select"
        >
          <option value="">None</option>
          {environments.map((env) => (
            <option key={env.name} value={env.name}>
              {env.name}
            </option>
          ))}
        </select>
      </div>

      {/* ── Headers (key-value table) ── */}
      <div className="re-section">
        <label className="re-label">Headers</label>
        <table className="re-headers-table">
          <thead>
            <tr>
              <th className="re-hdr-check"></th>
              <th className="re-hdr-key">Key</th>
              <th className="re-hdr-val">Value</th>
              <th className="re-hdr-del"></th>
            </tr>
          </thead>
          <tbody>
            {headers.map((row, i) => (
              <tr key={i} className={row.enabled ? "" : "re-hdr-disabled"}>
                <td className="re-hdr-check">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => {
                      const next = [...headers];
                      next[i] = { ...row, enabled: e.target.checked };
                      setHeaders(next);
                    }}
                  />
                </td>
                <td className="re-hdr-key">
                  <input
                    type="text"
                    placeholder="Header name"
                    value={row.key}
                    onChange={(e) => {
                      const next = [...headers];
                      next[i] = { ...row, key: e.target.value };
                      // Auto-add a new empty row when typing into the last row
                      if (i === headers.length - 1 && e.target.value) {
                        next.push({ key: "", value: "", enabled: true });
                      }
                      setHeaders(next);
                    }}
                  />
                </td>
                <td className="re-hdr-val">
                  <input
                    type="text"
                    placeholder="Value"
                    value={row.value}
                    onChange={(e) => {
                      const next = [...headers];
                      next[i] = { ...row, value: e.target.value };
                      if (i === headers.length - 1 && e.target.value) {
                        next.push({ key: "", value: "", enabled: true });
                      }
                      setHeaders(next);
                    }}
                  />
                </td>
                <td className="re-hdr-del">
                  {headers.length > 1 && (
                    <button
                      className="re-hdr-remove"
                      onClick={() => {
                        const next = headers.filter((_, j) => j !== i);
                        if (next.length === 0)
                          next.push({ key: "", value: "", enabled: true });
                        setHeaders(next);
                      }}
                      title="Remove header"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Body ── */}
      {(method === "POST" || method === "PUT" || method === "PATCH") && (
        <div className="re-section">
          <label className="re-label">
            Body <span className="re-hint">(raw JSON)</span>
          </label>
          <textarea
            className="re-textarea re-body"
            rows={8}
            placeholder='{ "key": "value" }'
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      )}

      {/* ── Save row ── */}
      <div className="re-actions">
        <select
          value={collectionName}
          onChange={(e) => setCollectionName(e.target.value)}
          className="re-collection-select"
        >
          <option value="">Select collection…</option>
          {collections.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="re-save-btn" onClick={handleSave} disabled={!url}>
          Save
        </button>
        <button className="re-new-btn" onClick={handleNew}>
          New
        </button>
      </div>
    </div>
  );
};
