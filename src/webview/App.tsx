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
import { RequestEditor } from "./RequestEditor";
import { ResponseViewer } from "./ResponseViewer";

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

  // ─── Resizable split pane ────────────────────────────────────────────────
  const [leftWidth, setLeftWidth] = useState(50); // percentage
  const [isDragging, setIsDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      // Clamp between 20% and 80%
      setLeftWidth(Math.min(80, Math.max(20, pct)));
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
  }, [isDragging]);

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
  return (
    <div className="app-root">
      {warning && <div className="app-warning">{warning}</div>}
      <div className="app-split" ref={splitRef}>
        <div
          className="app-pane app-left"
          style={{ flexBasis: `${leftWidth}%`, flexGrow: 0, flexShrink: 0 }}
        >
          <h2 className="pane-title">Request</h2>
          <RequestEditor
            activeRequest={activeRequest}
            activeCollectionName={activeCollectionName}
            collections={collections}
            environments={environments}
            sending={sending}
            onSend={handleSend}
          />
        </div>
        <div
          className={`app-divider${isDragging ? " dragging" : ""}`}
          onMouseDown={onDividerMouseDown}
        />
        <div className="app-pane app-right" style={{ flex: 1 }}>
          <h2 className="pane-title">Response</h2>
          <ResponseViewer result={result} error={error} loading={sending} />
        </div>
      </div>
    </div>
  );
};

export default App;
