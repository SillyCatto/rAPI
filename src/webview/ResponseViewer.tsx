/**
 * ResponseViewer.tsx — Right pane: status, timing, response headers, body (pretty / raw).
 * Includes a lightweight JSON syntax highlighter (no external deps).
 */

import React, { useMemo, useState } from "react";
import type { RequestResult } from "../types";

interface Props {
  result: RequestResult | null;
  error: string | null;
  loading: boolean;
}

export const ResponseViewer: React.FC<Props> = ({ result, error, loading }) => {
  const [viewMode, setViewMode] = useState<"pretty" | "raw">("pretty");
  const [showHeaders, setShowHeaders] = useState(false);

  if (loading) {
    return (
      <div className="rv-container rv-center">
        <span className="rv-spinner" /> Sending request…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rv-container rv-center rv-error">
        <strong>Error</strong>
        <pre>{error}</pre>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rv-container rv-center rv-placeholder">
        <p>Send a request to see the response here.</p>
        <p className="rv-hint">Ctrl/Cmd + Enter to send</p>
      </div>
    );
  }

  const statusClass =
    result.status >= 200 && result.status < 300
      ? "rv-status-ok"
      : result.status >= 400
        ? "rv-status-err"
        : "rv-status-other";

  return (
    <div className="rv-container">
      {/* ── Status bar ── */}
      <div className="rv-status-bar">
        <span className={`rv-status ${statusClass}`}>
          {result.status} {result.statusText}
        </span>
        <span className="rv-time">{result.durationMs} ms</span>
        <span className="rv-size">{formatBytes(result.bodyText.length)}</span>
      </div>

      {/* ── Headers (collapsible) ── */}
      <div className="rv-section">
        <button
          className="rv-toggle"
          onClick={() => setShowHeaders(!showHeaders)}
        >
          {showHeaders ? "▾" : "▸"} Headers (
          {Object.keys(result.headers).length})
        </button>
        {showHeaders && (
          <table className="rv-headers-table">
            <tbody>
              {Object.entries(result.headers).map(([k, v]) => (
                <tr key={k}>
                  <td className="rv-hdr-key">{k}</td>
                  <td className="rv-hdr-val">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Body view toggle ── */}
      <div className="rv-view-toggle">
        <button
          className={viewMode === "pretty" ? "active" : ""}
          onClick={() => setViewMode("pretty")}
        >
          Pretty
        </button>
        <button
          className={viewMode === "raw" ? "active" : ""}
          onClick={() => setViewMode("raw")}
        >
          Raw
        </button>
      </div>

      {/* ── Body ── */}
      <pre className="rv-body">
        {viewMode === "pretty" ? (
          <PrettyBody result={result} />
        ) : (
          result.bodyText
        )}
      </pre>
    </div>
  );
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Detect content type ─────────────────────────────────────────────────────

function isHtmlContent(result: RequestResult): boolean {
  const ct =
    result.headers["content-type"] ?? result.headers["Content-Type"] ?? "";
  return ct.includes("html");
}

// ─── Pretty body dispatcher ──────────────────────────────────────────────────

const PrettyBody: React.FC<{ result: RequestResult }> = ({ result }) => {
  if (result.bodyJson) {
    return <SyntaxHighlightedJson json={result.bodyJson} />;
  }
  if (isHtmlContent(result)) {
    return <SyntaxHighlightedHtml text={result.bodyText} />;
  }
  return <>{result.bodyText}</>;
};

// ─── JSON syntax highlighter ─────────────────────────────────────────────────

interface Token {
  type: string;
  value: string;
}

function tokenizeJson(json: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /("(?:[^"\\]|\\.)*")\s*:|"(?:[^"\\]|\\.)*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\bnull\b|([{}\[\],:])/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = re.exec(json)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "ws", value: json.slice(lastIndex, match.index) });
    }
    const full = match[0];
    if (match[1]) {
      tokens.push({ type: "key", value: match[1] });
      tokens.push({ type: "punct", value: full.slice(match[1].length) });
    } else if (match[3]) {
      tokens.push({ type: "bool", value: full });
    } else if (full === "null") {
      tokens.push({ type: "null", value: full });
    } else if (match[2]) {
      tokens.push({ type: "number", value: full });
    } else if (match[4]) {
      tokens.push({ type: "punct", value: full });
    } else {
      tokens.push({ type: "string", value: full });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < json.length) {
    tokens.push({ type: "ws", value: json.slice(lastIndex) });
  }
  return tokens;
}

const SyntaxHighlightedJson: React.FC<{ json: any }> = ({ json }) => {
  const tokens = useMemo(
    () => tokenizeJson(JSON.stringify(json, null, 2)),
    [json],
  );
  return (
    <code>
      {tokens.map((tok, i) => {
        const cls =
          tok.type !== "ws" && tok.type !== "punct"
            ? `syn-${tok.type}`
            : undefined;
        return cls ? (
          <span key={i} className={cls}>
            {tok.value}
          </span>
        ) : (
          <span key={i}>{tok.value}</span>
        );
      })}
    </code>
  );
};

// ─── HTML syntax highlighter ─────────────────────────────────────────────────

function tokenizeHtml(html: string): Token[] {
  const tokens: Token[] = [];
  // Matches comments, doctypes, tags (with attributes), and text between tags
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/?[a-zA-Z][^>]*\/?>|[^<]+/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const full = match[0];

    if (full.startsWith("<!--")) {
      tokens.push({ type: "comment", value: full });
    } else if (full.startsWith("<!")) {
      tokens.push({ type: "doctype", value: full });
    } else if (full.startsWith("<")) {
      // Parse tag: <tagName attr="value" ...>
      const tagRe = /(<\/?)([\w-]+)((?:\s+[\s\S]*?)?)(\s*\/?>)/;
      const tm = tagRe.exec(full);
      if (tm) {
        tokens.push({ type: "tag", value: tm[1] }); // < or </
        tokens.push({ type: "tag", value: tm[2] }); // tag name
        // Parse attributes within tm[3]
        if (tm[3]) {
          const attrStr = tm[3];
          const attrRe = /([\w-:]+)(\s*=\s*)(["'][^"']*["']|[\w-]+)|(\s+)/g;
          let am: RegExpExecArray | null;
          let ai = 0;
          while ((am = attrRe.exec(attrStr)) !== null) {
            if (am.index > ai) {
              tokens.push({ type: "ws", value: attrStr.slice(ai, am.index) });
            }
            if (am[4]) {
              tokens.push({ type: "ws", value: am[4] });
            } else {
              tokens.push({ type: "attr-name", value: am[1] });
              tokens.push({ type: "punct", value: am[2] });
              tokens.push({ type: "attr-value", value: am[3] });
            }
            ai = attrRe.lastIndex;
          }
          if (ai < attrStr.length) {
            tokens.push({ type: "ws", value: attrStr.slice(ai) });
          }
        }
        tokens.push({ type: "tag", value: tm[4] }); // > or />
      } else {
        tokens.push({ type: "tag", value: full });
      }
    } else {
      // Plain text content
      tokens.push({ type: "ws", value: full });
    }
  }
  return tokens;
}

const SyntaxHighlightedHtml: React.FC<{ text: string }> = ({ text }) => {
  const tokens = useMemo(() => tokenizeHtml(text), [text]);
  return (
    <code>
      {tokens.map((tok, i) => {
        const cls =
          tok.type !== "ws" && tok.type !== "punct"
            ? `syn-${tok.type}`
            : undefined;
        return cls ? (
          <span key={i} className={cls}>
            {tok.value}
          </span>
        ) : (
          <span key={i}>{tok.value}</span>
        );
      })}
    </code>
  );
};
