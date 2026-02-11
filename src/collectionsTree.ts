/**
 * CollectionsTreeProvider — Sidebar tree view listing `.rapi/collections/` files
 * and the requests within each collection.
 *
 * Tree structure:
 *   Collection: users
 *     ├─ GET  /users
 *     └─ POST /users
 */

import * as vscode from "vscode";
import * as fileStore from "./api/fileStore";
import { Collection, RequestSpec } from "./types";

// ─── Tree Items ──────────────────────────────────────────────────────────────

export class CollectionItem extends vscode.TreeItem {
  constructor(public readonly collection: Collection) {
    super(collection.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "collection";
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

export class RequestItem extends vscode.TreeItem {
  constructor(
    public readonly request: RequestSpec,
    public readonly collectionName: string,
  ) {
    super(
      `${request.method} ${request.name}`,
      vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = "request";
    this.tooltip = `${request.method} ${request.url}`;
    this.iconPath = new vscode.ThemeIcon("symbol-method");
    this.command = {
      title: "Open Request",
      command: "rapi.openRequest",
      arguments: [request, collectionName],
    };
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class CollectionsTreeProvider implements vscode.TreeDataProvider<
  CollectionItem | RequestItem
> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    CollectionItem | RequestItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private collections: Collection[] = [];

  async refresh(): Promise<void> {
    this.collections = await fileStore.readCollections();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CollectionItem | RequestItem): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: CollectionItem | RequestItem,
  ): vscode.ProviderResult<(CollectionItem | RequestItem)[]> {
    if (!element) {
      // Root level: return collections
      return this.collections.map((c) => new CollectionItem(c));
    }
    if (element instanceof CollectionItem) {
      return element.collection.requests.map(
        (r) => new RequestItem(r, element.collection.name),
      );
    }
    return [];
  }
}

// ─── Environments Tree (simple flat list) ────────────────────────────────────

export class EnvironmentItem extends vscode.TreeItem {
  constructor(public readonly envName: string) {
    super(envName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "environment";
    this.iconPath = new vscode.ThemeIcon("symbol-variable");
  }
}

export class EnvironmentsTreeProvider implements vscode.TreeDataProvider<EnvironmentItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    EnvironmentItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private envNames: string[] = [];

  async refresh(): Promise<void> {
    const envs = await fileStore.readEnvironments();
    this.envNames = envs.map((e) => e.name);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: EnvironmentItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<EnvironmentItem[]> {
    return this.envNames.map((n) => new EnvironmentItem(n));
  }
}
