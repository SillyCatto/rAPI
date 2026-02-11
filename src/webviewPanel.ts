/**
 * WebviewPanelManager — Creates and manages the main rAPI webview panel.
 *
 * Handles:
 *   - Panel lifecycle (create / reveal / dispose)
 *   - Message routing between onDidReceiveMessage and extension logic
 *   - Serving the webview HTML with bundled JS/CSS
 */

import * as vscode from "vscode";
import * as fileStore from "./api/fileStore";
import { sendRequest } from "./api/requester";
import { getThemeTokenColors, tokenColorsToCss } from "./themeColors";
import {
  Environment,
  ExtensionMessage,
  RequestSpec,
  WebviewMessage,
} from "./types";

export class WebviewPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private themeDisposable: vscode.Disposable | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Open (or reveal) the rAPI webview panel. */
  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "rapi.requestPanel",
      "rAPI",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
        ],
      },
    );

    this.panel.webview.html = await this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      undefined,
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.themeDisposable?.dispose();
      this.themeDisposable = undefined;
    });

    // Push updated syntax colors when the user switches themes (no full reload)
    this.themeDisposable = vscode.window.onDidChangeActiveColorTheme(
      async () => {
        if (this.panel) {
          const colors = await getThemeTokenColors();
          this.postMessage({
            type: "themeColorsUpdated",
            payload: {
              css: {
                "--rapi-syn-key": colors.key,
                "--rapi-syn-string": colors.string,
                "--rapi-syn-number": colors.number,
                "--rapi-syn-bool": colors.bool,
                "--rapi-syn-null": colors.nullVal,
                "--rapi-syn-tag": colors.tag,
                "--rapi-syn-attr-name": colors.attrName,
                "--rapi-syn-attr-value": colors.attrValue,
                "--rapi-syn-comment": colors.comment,
                "--rapi-syn-punctuation": colors.punctuation,
              },
            },
          });
        }
      },
    );
  }

  /** Send a request to be loaded in the webview editor. */
  openRequestInEditor(request: RequestSpec, collectionName: string): void {
    this.open();
    this.postMessage({
      type: "openRequestInEditor",
      payload: { request, collectionName },
    });
  }

  /** Post a message to the webview. */
  private postMessage(msg: ExtensionMessage): void {
    this.panel?.webview.postMessage(msg);
  }

  // ─── Message handler ────────────────────────────────────────────────────────

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case "webviewReady":
      case "loadCollections": {
        const collections = await fileStore.readCollections();
        this.postMessage({
          type: "collectionsLoaded",
          payload: { collections },
        });
        break;
      }

      case "loadEnvironments": {
        const environments = await fileStore.readEnvironments();
        this.postMessage({
          type: "environmentsLoaded",
          payload: { environments },
        });
        break;
      }

      case "sendRequest": {
        const { request, envName } = msg.payload;
        try {
          let env: Environment | undefined;
          if (envName) {
            const envs = await fileStore.readEnvironments();
            env = envs.find((e) => e.name === envName);
          }
          const { result, missingVars } = await sendRequest(request, env);

          if (missingVars.length > 0) {
            this.postMessage({
              type: "warning",
              payload: {
                message: `Missing environment variables: ${missingVars.join(", ")}`,
              },
            });
          }

          this.postMessage({
            type: "requestResult",
            payload: { result, requestId: request.id },
          });
        } catch (err: any) {
          this.postMessage({
            type: "requestError",
            payload: {
              error: err?.message ?? "Unknown error",
              requestId: request.id,
            },
          });
        }
        break;
      }

      case "saveRequest": {
        const { collectionName, request } = msg.payload;
        await fileStore.saveRequestToCollection(collectionName, request);
        // Inform the webview that collections changed
        const collections = await fileStore.readCollections();
        this.postMessage({
          type: "collectionsLoaded",
          payload: { collections },
        });
        // Also fire a VS Code event so the tree view can refresh
        vscode.commands.executeCommand("rapi.refreshCollections");
        break;
      }

      case "deleteRequest": {
        const { collectionName, requestId } = msg.payload;
        await fileStore.deleteRequestFromCollection(collectionName, requestId);
        const collections = await fileStore.readCollections();
        this.postMessage({
          type: "collectionsLoaded",
          payload: { collections },
        });
        vscode.commands.executeCommand("rapi.refreshCollections");
        break;
      }

      case "createCollection": {
        await fileStore.createCollection(msg.payload.name);
        const collections = await fileStore.readCollections();
        this.postMessage({
          type: "collectionsLoaded",
          payload: { collections },
        });
        vscode.commands.executeCommand("rapi.refreshCollections");
        break;
      }
    }
  }

  // ─── HTML shell ─────────────────────────────────────────────────────────────

  private async getHtml(webview: vscode.Webview): Promise<string> {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "webview.js"),
    );

    const nonce = getNonce();
    const tokenColors = await getThemeTokenColors();
    const tokenCss = tokenColorsToCss(tokenColors);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <title>rAPI</title>
  <style>
    /* Reset & base */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root {
      height: 100%;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    /* Syntax token colors extracted from active theme */
    :root {
      ${tokenCss}
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
