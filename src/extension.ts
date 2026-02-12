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
  CollectionItem,
  CollectionsTreeProvider,
  EnvironmentsTreeProvider,
  RequestItem,
} from "./collectionsTree";
import { RequestSpec } from "./types";
import { WebviewPanelManager } from "./webviewPanel";

function newId(): string {
  return (
    "req-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

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
      // Auto-generate a default name like "Untitled Collection-1"
      const existing = await fileStore.readCollections();
      const untitledNames = existing
        .map((c) => c.name)
        .filter((n) => n.startsWith("Untitled Collection"));
      let nextNum = 1;
      while (untitledNames.includes(`Untitled Collection-${nextNum}`)) {
        nextNum++;
      }
      const defaultName = `Untitled Collection-${nextNum}`;

      const name = await vscode.window.showInputBox({
        prompt: "Collection name",
        value: defaultName,
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
    vscode.commands.registerCommand(
      "rapi.newHttpRequest",
      async (item?: CollectionItem) => {
        let collectionName: string;
        if (item instanceof CollectionItem) {
          collectionName = item.collection.name;
        } else {
          // Fallback: ask user to pick a collection
          const collections = await fileStore.readCollections();
          if (collections.length === 0) {
            vscode.window.showWarningMessage("Create a collection first.");
            return;
          }
          const picked = await vscode.window.showQuickPick(
            collections.map((c) => c.name),
            { placeHolder: "Select a collection" },
          );
          if (!picked) return;
          collectionName = picked;
        }

        const newReq: RequestSpec = {
          id: newId(),
          name: "New Request",
          method: "GET",
          url: "",
          headers: {},
          body: null,
          createdAt: new Date().toISOString(),
        };

        await fileStore.saveRequestToCollection(collectionName, newReq);
        collectionsTree.refresh();
        panelManager.openRequestInEditor(newReq, collectionName);
      },
    ),
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

  // Delete a request from sidebar context menu
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "rapi.deleteRequest",
      async (item?: RequestItem) => {
        if (!(item instanceof RequestItem)) return;
        const confirm = await vscode.window.showWarningMessage(
          `Delete request "${item.request.name}" from ${item.collectionName}?`,
          { modal: true },
          "Delete",
        );
        if (confirm === "Delete") {
          await fileStore.deleteRequestFromCollection(
            item.collectionName,
            item.request.id,
          );
          collectionsTree.refresh();
        }
      },
    ),
  );

  // Ellipsis menu for collections (shows QuickPick with actions)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "rapi.collectionMenu",
      async (item?: CollectionItem) => {
        if (!(item instanceof CollectionItem)) return;
        const action = await vscode.window.showQuickPick(
          [
            { label: "$(add) New HTTP Request", action: "newRequest" },
            { label: "$(edit) Rename Collection", action: "rename" },
            { label: "$(trash) Delete Collection", action: "delete" },
          ],
          { placeHolder: item.collection.name },
        );
        if (!action) return;
        if (action.action === "newRequest") {
          vscode.commands.executeCommand("rapi.newHttpRequest", item);
        } else if (action.action === "rename") {
          const newName = await vscode.window.showInputBox({
            prompt: "New collection name",
            value: item.collection.name,
          });
          if (newName && newName !== item.collection.name) {
            await fileStore.renameCollection(
              item.collection.name,
              newName.trim(),
            );
            collectionsTree.refresh();
          }
        } else if (action.action === "delete") {
          const confirm = await vscode.window.showWarningMessage(
            `Delete collection "${item.collection.name}" and all its requests?`,
            { modal: true },
            "Delete",
          );
          if (confirm === "Delete") {
            await fileStore.deleteCollection(item.collection.name);
            collectionsTree.refresh();
          }
        }
      },
    ),
  );

  // Ellipsis menu for requests (shows QuickPick with actions)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "rapi.requestMenu",
      async (item?: RequestItem) => {
        if (!(item instanceof RequestItem)) return;
        const action = await vscode.window.showQuickPick(
          [
            { label: "$(play) Open Request", action: "open" },
            { label: "$(copy) Duplicate Request", action: "duplicate" },
            { label: "$(trash) Delete Request", action: "delete" },
          ],
          { placeHolder: `${item.request.method} ${item.request.name}` },
        );
        if (!action) return;
        if (action.action === "open") {
          panelManager.openRequestInEditor(item.request, item.collectionName);
        } else if (action.action === "duplicate") {
          const copy: RequestSpec = {
            ...item.request,
            id: newId(),
            name: `${item.request.name} (copy)`,
            createdAt: new Date().toISOString(),
          };
          await fileStore.saveRequestToCollection(item.collectionName, copy);
          collectionsTree.refresh();
        } else if (action.action === "delete") {
          vscode.commands.executeCommand("rapi.deleteRequest", item);
        }
      },
    ),
  );

  console.log("rAPI extension activated");
}

export function deactivate() {
  // Nothing to clean up
}
