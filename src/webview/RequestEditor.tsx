/**
 * RequestEditor.tsx — Left pane: method selector, URL, tabbed Params/Headers/Body, send/save.
 */

import React, { useCallback, useEffect, useState } from "react";
import type { Collection, Environment, RequestSpec } from "../types";
import { postToExtension } from "./messaging";

export interface RequestEditorHandle {
  collectionName: string;
  setCollectionName: (name: string) => void;
  handleSave: () => void;
  url: string;
  collections: Collection[];
}

interface Props {
  activeRequest: RequestSpec | null;
  activeCollectionName: string;
  collections: Collection[];
  environments: Environment[];
  sending: boolean;
  onSend: () => void;
  onEditorReady: (handle: RequestEditorHandle) => void;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

const METHOD_COLORS: Record<string, string> = {
  GET: "#49cc90",
  POST: "#fca130",
  PUT: "#50e3c2",
  PATCH: "#d4a017",
  DELETE: "#f93e3e",
  OPTIONS: "#d63aff",
};

interface KvRow {
  key: string;
  value: string;
  enabled: boolean;
}

type ReqTab = "params" | "headers" | "body";

function newId(): string {
  return (
    "req-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

/** Parse query string from a URL into KvRow[] */
function parseQueryParams(rawUrl: string): KvRow[] {
  try {
    const qIdx = rawUrl.indexOf("?");
    if (qIdx === -1) return [{ key: "", value: "", enabled: true }];
    const qs = rawUrl.slice(qIdx + 1);
    const pairs = qs.split("&").filter(Boolean);
    const rows: KvRow[] = pairs.map((p) => {
      const [k, ...rest] = p.split("=");
      return {
        key: decodeURIComponent(k),
        value: decodeURIComponent(rest.join("=")),
        enabled: true,
      };
    });
    rows.push({ key: "", value: "", enabled: true });
    return rows;
  } catch {
    return [{ key: "", value: "", enabled: true }];
  }
}

/** Build a query string from KvRow[] and merge back onto the base URL */
function buildUrlWithParams(baseUrl: string, params: KvRow[]): string {
  const active = params.filter((r) => r.enabled && r.key.trim());
  const base = baseUrl.split("?")[0];
  if (active.length === 0) return base;
  const qs = active
    .map(
      (r) =>
        `${encodeURIComponent(r.key.trim())}=${encodeURIComponent(r.value)}`,
    )
    .join("&");
  return `${base}?${qs}`;
}

export const RequestEditor: React.FC<Props> = ({
  activeRequest,
  activeCollectionName,
  collections,
  environments,
  sending,
  onSend,
  onEditorReady,
}) => {
  const [method, setMethod] = useState<RequestSpec["method"]>("GET");
  const [url, setUrl] = useState("");
  const [params, setParams] = useState<KvRow[]>([
    { key: "", value: "", enabled: true },
  ]);
  const [headers, setHeaders] = useState<KvRow[]>([
    { key: "", value: "", enabled: true },
  ]);
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [envName, setEnvName] = useState("");
  const [requestId, setRequestId] = useState(newId());
  const [activeTab, setActiveTab] = useState<ReqTab>("params");

  // Sync from parent when a request is opened from the sidebar
  useEffect(() => {
    if (activeRequest) {
      setMethod(activeRequest.method);
      setUrl(activeRequest.url);
      setName(activeRequest.name);
      setBody(activeRequest.body ?? "");
      setRequestId(activeRequest.id);
      setParams(parseQueryParams(activeRequest.url));
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

  // When the user edits the URL bar directly, sync query params
  const handleUrlChange = useCallback((raw: string) => {
    setUrl(raw);
    setParams(parseQueryParams(raw));
  }, []);

  // When params table changes, rebuild the URL
  const handleParamsChange = useCallback(
    (nextParams: KvRow[]) => {
      setParams(nextParams);
      setUrl(buildUrlWithParams(url, nextParams));
    },
    [url],
  );

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

  const handleSave = useCallback(() => {
    const targetCollection = collectionName || "default";
    const spec = buildSpec();
    postToExtension({
      type: "saveRequest",
      payload: { collectionName: targetCollection, request: spec },
    });
  }, [collectionName, buildSpec]);

  // Expose save handle to parent for the pane-title save button
  useEffect(() => {
    onEditorReady({
      collectionName,
      setCollectionName,
      handleSave,
      url,
      collections,
    });
  }, [collectionName, handleSave, url, collections, onEditorReady]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  // Badge counts for tab labels
  const paramCount = params.filter((r) => r.enabled && r.key.trim()).length;
  const headerCount = headers.filter((r) => r.enabled && r.key.trim()).length;
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";

  return (
    <div className="request-editor" onKeyDown={handleKeyDown}>
      {/* ── Request name ── */}
      <div className="re-row">
        <input
          className="re-name"
          type="text"
          placeholder="Request name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* ── Top bar: method + URL + Save + Send ── */}
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
          onChange={(e) => handleUrlChange(e.target.value)}
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

      {/* ── Tabs: Params | Headers | Body ── */}
      <div className="tab-bar">
        <button
          className={`tab-btn${activeTab === "params" ? " active" : ""}`}
          onClick={() => setActiveTab("params")}
        >
          Params
          {paramCount > 0 && <span className="tab-badge">{paramCount}</span>}
        </button>
        <button
          className={`tab-btn${activeTab === "headers" ? " active" : ""}`}
          onClick={() => setActiveTab("headers")}
        >
          Headers
          {headerCount > 0 && <span className="tab-badge">{headerCount}</span>}
        </button>
        <button
          className={`tab-btn${activeTab === "body" ? " active" : ""}${!hasBody ? " tab-disabled" : ""}`}
          onClick={() => hasBody && setActiveTab("body")}
        >
          Body
        </button>
      </div>

      {/* ── Tab panels ── */}
      <div className="tab-panel">
        {activeTab === "params" && (
          <KvTable
            rows={params}
            onChange={handleParamsChange}
            keyPlaceholder="Parameter name"
            valuePlaceholder="Value"
          />
        )}

        {activeTab === "headers" && (
          <KvTable
            rows={headers}
            onChange={setHeaders}
            keyPlaceholder="Header name"
            valuePlaceholder="Value"
          />
        )}

        {activeTab === "body" && hasBody && (
          <textarea
            className="re-textarea re-body"
            rows={10}
            placeholder='{ "key": "value" }'
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}

        {activeTab === "body" && !hasBody && (
          <div className="re-body-disabled">
            Body is not available for {method} requests.
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Reusable Key-Value table (used by Params & Headers tabs) ──────────── */

interface KvTableProps {
  rows: KvRow[];
  onChange: (rows: KvRow[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}

const KvTable: React.FC<KvTableProps> = ({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}) => {
  const updateRow = (i: number, patch: Partial<KvRow>) => {
    const next = [...rows];
    next[i] = { ...rows[i], ...patch };
    // Auto-add empty row when typing into the last row
    if (
      i === rows.length - 1 &&
      (patch.key || patch.value) &&
      (next[i].key || next[i].value)
    ) {
      next.push({ key: "", value: "", enabled: true });
    }
    onChange(next);
  };

  const removeRow = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    if (next.length === 0) next.push({ key: "", value: "", enabled: true });
    onChange(next);
  };

  return (
    <table className="re-kv-table">
      <thead>
        <tr>
          <th className="re-hdr-check"></th>
          <th className="re-hdr-key">Key</th>
          <th className="re-hdr-val">Value</th>
          <th className="re-hdr-del"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={row.enabled ? "" : "re-hdr-disabled"}>
            <td className="re-hdr-check">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => updateRow(i, { enabled: e.target.checked })}
              />
            </td>
            <td className="re-hdr-key">
              <input
                type="text"
                placeholder={keyPlaceholder}
                value={row.key}
                onChange={(e) => updateRow(i, { key: e.target.value })}
              />
            </td>
            <td className="re-hdr-val">
              <input
                type="text"
                placeholder={valuePlaceholder}
                value={row.value}
                onChange={(e) => updateRow(i, { value: e.target.value })}
              />
            </td>
            <td className="re-hdr-del">
              {rows.length > 1 && (
                <button
                  className="re-hdr-remove"
                  onClick={() => removeRow(i)}
                  title="Remove row"
                >
                  ×
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
