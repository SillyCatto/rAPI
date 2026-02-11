/**
 * fileStore.ts — read/write .rapi collections and environments from workspace filesystem.
 *
 * All persistence is plain JSON files under `<workspaceRoot>/.rapi/`.
 * Collections live in `.rapi/collections/*.json`.
 * Environments live in `.rapi/environments/*.json`.
 */

import * as vscode from "vscode";
import { Collection, Environment, RequestSpec } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function workspaceRoot(): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("No workspace folder is open.");
  }
  return folders[0].uri;
}

function rapiRoot(): vscode.Uri {
  return vscode.Uri.joinPath(workspaceRoot(), ".rapi");
}

function collectionsDir(): vscode.Uri {
  return vscode.Uri.joinPath(rapiRoot(), "collections");
}

function environmentsDir(): vscode.Uri {
  return vscode.Uri.joinPath(rapiRoot(), "environments");
}

async function ensureDir(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    await vscode.workspace.fs.createDirectory(uri);
  }
}

async function readJsonFile<T>(uri: vscode.Uri): Promise<T> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = Buffer.from(bytes).toString("utf-8");
  return JSON.parse(text) as T;
}

async function writeJsonFile(uri: vscode.Uri, data: unknown): Promise<void> {
  const text = JSON.stringify(data, null, 2) + "\n";
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf-8"));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Ensure the `.rapi/` directory structure exists. */
export async function ensureRapiStructure(): Promise<void> {
  await ensureDir(rapiRoot());
  await ensureDir(collectionsDir());
  await ensureDir(environmentsDir());
}

/** Read all collection files from `.rapi/collections/`. */
export async function readCollections(): Promise<Collection[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(collectionsDir());
    const jsonFiles = entries.filter(
      ([name, type]) => type === vscode.FileType.File && name.endsWith(".json"),
    );
    const results: Collection[] = [];
    for (const [name] of jsonFiles) {
      try {
        const uri = vscode.Uri.joinPath(collectionsDir(), name);
        const col = await readJsonFile<Collection>(uri);
        results.push(col);
      } catch (e) {
        console.warn(`rAPI: Skipping invalid collection file ${name}:`, e);
      }
    }
    return results;
  } catch {
    return [];
  }
}

/** Read all environment files from `.rapi/environments/`. */
export async function readEnvironments(): Promise<Environment[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(environmentsDir());
    const jsonFiles = entries.filter(
      ([name, type]) => type === vscode.FileType.File && name.endsWith(".json"),
    );
    const results: Environment[] = [];
    for (const [name] of jsonFiles) {
      try {
        const uri = vscode.Uri.joinPath(environmentsDir(), name);
        const env = await readJsonFile<Environment>(uri);
        results.push(env);
      } catch (e) {
        console.warn(`rAPI: Skipping invalid environment file ${name}:`, e);
      }
    }
    return results;
  } catch {
    return [];
  }
}

/** Save (upsert) a request into a collection file. Creates the file if needed. */
export async function saveRequestToCollection(
  collectionName: string,
  request: RequestSpec,
): Promise<void> {
  await ensureRapiStructure();
  const fileName = collectionName.endsWith(".json")
    ? collectionName
    : `${collectionName}.json`;
  const uri = vscode.Uri.joinPath(collectionsDir(), fileName);

  let collection: Collection;
  try {
    collection = await readJsonFile<Collection>(uri);
  } catch {
    collection = { name: collectionName.replace(/\.json$/, ""), requests: [] };
  }

  // Upsert by id
  const idx = collection.requests.findIndex((r) => r.id === request.id);
  const now = new Date().toISOString();
  request.updatedAt = now;
  if (idx >= 0) {
    collection.requests[idx] = request;
  } else {
    request.createdAt = now;
    collection.requests.push(request);
  }

  await writeJsonFile(uri, collection);
}

/** Delete a request from a collection file. */
export async function deleteRequestFromCollection(
  collectionName: string,
  requestId: string,
): Promise<void> {
  const fileName = collectionName.endsWith(".json")
    ? collectionName
    : `${collectionName}.json`;
  const uri = vscode.Uri.joinPath(collectionsDir(), fileName);

  try {
    const collection = await readJsonFile<Collection>(uri);
    collection.requests = collection.requests.filter((r) => r.id !== requestId);
    await writeJsonFile(uri, collection);
  } catch {
    // file doesn't exist, nothing to delete
  }
}

/** Create a new empty collection file. */
export async function createCollection(name: string): Promise<void> {
  await ensureRapiStructure();
  const fileName = name.endsWith(".json") ? name : `${name}.json`;
  const uri = vscode.Uri.joinPath(collectionsDir(), fileName);
  const collection: Collection = {
    name: name.replace(/\.json$/, ""),
    requests: [],
  };
  await writeJsonFile(uri, collection);
}

/** Write sample files if `.rapi/` is empty. */
export async function writeSampleFiles(): Promise<void> {
  await ensureRapiStructure();

  // Sample collection
  const sampleColUri = vscode.Uri.joinPath(collectionsDir(), "example.json");
  try {
    await vscode.workspace.fs.stat(sampleColUri);
  } catch {
    const sample: Collection = {
      name: "example",
      requests: [
        {
          id: "sample-get-1",
          name: "Get httpbin",
          method: "GET",
          url: "{{baseUrl}}/get",
          headers: { Accept: "application/json" },
          body: null,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    await writeJsonFile(sampleColUri, sample);
  }

  // Sample environment
  const sampleEnvUri = vscode.Uri.joinPath(environmentsDir(), "dev.json");
  try {
    await vscode.workspace.fs.stat(sampleEnvUri);
  } catch {
    const sample: Environment = {
      name: "dev",
      values: {
        baseUrl: "https://httpbin.org",
        token: "REPLACE_ME",
      },
    };
    await writeJsonFile(sampleEnvUri, sample);
  }
}
