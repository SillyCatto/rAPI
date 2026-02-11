/**
 * Webview entry point — mounts the React app into #root.
 */

import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
