/**
 * extension.ts — rAPI extension entry point.
 *
 * Activation:
 *   - Registers commands (`rAPI: Open rAPI`, `rAPI: Create Collection`)
 *   - Sets up sidebar tree views (Collections, Environments)
 *   - Watches `.rapi/` directory for changes to refresh tree views
 */

import * as vscode from "vscode";
import * as fileStore from "./api/fileStore";
import {
  CollectionsTreeProvider,
  EnvironmentsTreeProvider,
} from "./collectionsTree";
import { RequestSpec } from "./types";
import { WebviewPanelManager } from "./webviewPanel";

export function activate(context: vscode.ExtensionContext) {
  // ─── File store setup ──────────────────────────────────────────────────
  // Ensure .rapi/ structure and sample files exist
  fileStore.ensureRapiStructure().then(() => fileStore.writeSampleFiles());

  // ─── Webview panel manager ─────────────────────────────────────────────
  const panelManager = new WebviewPanelManager(context.extensionUri);

  // ─── Sidebar tree views ────────────────────────────────────────────────
  const collectionsTree = new CollectionsTreeProvider();
  const environmentsTree = new EnvironmentsTreeProvider();

  vscode.window.registerTreeDataProvider(
    "rapi.collectionsView",
    collectionsTree,
  );
  vscode.window.registerTreeDataProvider(
    "rapi.environmentsView",
    environmentsTree,
  );

  // Initial load
  collectionsTree.refresh();
  environmentsTree.refresh();

  // ─── File watcher — refresh trees when .rapi/ changes ──────────────────
  if (vscode.workspace.workspaceFolders?.[0]) {
    const pattern = new vscode.RelativePattern(
      vscode.workspace.workspaceFolders[0],
      ".rapi/**/*.json",
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(() => {
      collectionsTree.refresh();
      environmentsTree.refresh();
    });
    watcher.onDidCreate(() => {
      collectionsTree.refresh();
      environmentsTree.refresh();
    });
    watcher.onDidDelete(() => {
      collectionsTree.refresh();
      environmentsTree.refresh();
    });
    context.subscriptions.push(watcher);
  }

  // ─── Commands ──────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("rapi.open", () => {
      panelManager.open();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rapi.createCollection", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Collection name",
        placeHolder: "e.g. users",
        validateInput: (val) => (val.trim() ? null : "Name is required"),
      });
      if (name) {
        await fileStore.createCollection(name.trim());
        collectionsTree.refresh();
        vscode.window.showInformationMessage(`Collection "${name}" created.`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rapi.refreshCollections", () => {
      collectionsTree.refresh();
      environmentsTree.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "rapi.openRequest",
      (request: RequestSpec, collectionName: string) => {
        panelManager.openRequestInEditor(request, collectionName);
      },
    ),
  );

  // Send request shortcut (keybinding triggers this)
  context.subscriptions.push(
    vscode.commands.registerCommand("rapi.sendRequest", () => {
      // This is handled inside the webview via keyboard; no-op here
    }),
  );

  console.log("rAPI extension activated");
}

export function deactivate() {
  // Nothing to clean up
}
