/**
 * App.tsx — Top-level React component for the rAPI webview.
 *
 * Layout: split pane with RequestEditor on the left and ResponseViewer on the right.
 * All state is managed here and passed down as props.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  Collection,
  Environment,
  ExtensionMessage,
  RequestResult,
  RequestSpec,
} from "../types";
import { onExtensionMessage, postToExtension } from "./messaging";
import { RequestEditor, RequestEditorHandle } from "./RequestEditor";
import { ResponseViewer } from "./ResponseViewer";

type Layout = "horizontal" | "vertical";

const App: React.FC = () => {
  // ─── State ───────────────────────────────────────────────────────────────
  const [collections, setCollections] = useState<Collection[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeRequest, setActiveRequest] = useState<RequestSpec | null>(null);
  const [activeCollectionName, setActiveCollectionName] = useState("");
  const [result, setResult] = useState<RequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  // ─── Layout toggle ───────────────────────────────────────────────────────
  const [layout, setLayout] = useState<Layout>("horizontal");

  // ─── Editor save handle (lifted from RequestEditor) ──────────────────────
  const [editorHandle, setEditorHandle] = useState<RequestEditorHandle | null>(
    null,
  );
  const onEditorReady = useCallback((h: RequestEditorHandle) => {
    setEditorHandle(h);
  }, []);

  // ─── Resizable split pane ────────────────────────────────────────────────
  const [splitSize, setSplitSize] = useState(50); // percentage
  const [isDragging, setIsDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  const onDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      document.body.style.cursor =
        layout === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [layout],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      let pct: number;
      if (layout === "horizontal") {
        pct = ((e.clientX - rect.left) / rect.width) * 100;
      } else {
        pct = ((e.clientY - rect.top) / rect.height) * 100;
      }
      setSplitSize(Math.min(80, Math.max(20, pct)));
    };
    const onMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, layout]);

  // ─── Message listener ────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onExtensionMessage((msg: ExtensionMessage) => {
      switch (msg.type) {
        case "collectionsLoaded":
          setCollections(msg.payload.collections);
          break;
        case "environmentsLoaded":
          setEnvironments(msg.payload.environments);
          break;
        case "requestResult":
          setResult(msg.payload.result);
          setError(null);
          setSending(false);
          break;
        case "requestError":
          setError(msg.payload.error);
          setResult(null);
          setSending(false);
          break;
        case "openRequestInEditor":
          setActiveRequest(msg.payload.request);
          setActiveCollectionName(msg.payload.collectionName);
          setResult(null);
          setError(null);
          break;
        case "warning":
          setWarning(msg.payload.message);
          setTimeout(() => setWarning(null), 6000);
          break;
        case "themeColorsUpdated":
          // Apply updated syntax CSS variables directly — no reload needed
          for (const [prop, value] of Object.entries(msg.payload.css)) {
            document.documentElement.style.setProperty(prop, value);
          }
          break;
      }
    });

    // Ask extension for initial data
    postToExtension({ type: "webviewReady" });
    postToExtension({ type: "loadEnvironments" });

    return unsub;
  }, []);

  const handleSend = useCallback(() => {
    setSending(true);
    setResult(null);
    setError(null);
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────
  const isHoriz = layout === "horizontal";
  const splitStyle = isHoriz
    ? { flexBasis: `${splitSize}%`, flexGrow: 0, flexShrink: 0 }
    : { flexBasis: `${splitSize}%`, flexGrow: 0, flexShrink: 0 };

  return (
    <div className="app-root">
      {warning && <div className="app-warning">{warning}</div>}
      <div
        className={`app-split ${isHoriz ? "app-split-h" : "app-split-v"}`}
        ref={splitRef}
      >
        <div className="app-pane app-left" style={splitStyle}>
          <div className="pane-header">
            <h2 className="pane-title">Request</h2>
            <div className="pane-header-actions">
              {editorHandle && (
                <>
                  <select
                    value={editorHandle.collectionName}
                    onChange={(e) =>
                      editorHandle.setCollectionName(e.target.value)
                    }
                    className="re-collection-select pane-header-select"
                    title="Save to collection"
                  >
                    <option value="">Collection\u2026</option>
                    {editorHandle.collections.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="re-save-btn pane-header-btn"
                    onClick={editorHandle.handleSave}
                    disabled={!editorHandle.url}
                    title="Save request"
                  >
                    Save
                  </button>
                </>
              )}
            </div>
          </div>
          <RequestEditor
            activeRequest={activeRequest}
            activeCollectionName={activeCollectionName}
            collections={collections}
            environments={environments}
            sending={sending}
            onSend={handleSend}
            onEditorReady={onEditorReady}
          />
        </div>
        <div
          className={`app-divider${isDragging ? " dragging" : ""} ${isHoriz ? "app-divider-h" : "app-divider-v"}`}
          onMouseDown={onDividerMouseDown}
        />
        <div className="app-pane app-right" style={{ flex: 1 }}>
          <div className="pane-header">
            <h2 className="pane-title">Response</h2>
            <div className="pane-header-actions">
              <button
                className={`layout-toggle-btn${isHoriz ? " active" : ""}`}
                onClick={() => setLayout("horizontal")}
                title="Dock response to the right"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M14 1H2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 14V2h6v12H2zm12 0H9V2h5v12z" />
                </svg>
              </button>
              <button
                className={`layout-toggle-btn${!isHoriz ? " active" : ""}`}
                onClick={() => setLayout("vertical")}
                title="Dock response below"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M14 1H2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 14V9h12v5H2zm12-6H2V2h12v6z" />
                </svg>
              </button>
            </div>
          </div>
          <ResponseViewer result={result} error={error} loading={sending} />
        </div>
      </div>
    </div>
  );
};

export default App;
