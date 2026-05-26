// Google Drive v3 REST adapter.
//
// All requests go through `fetchWithAuth` which lazy-refreshes the access
// token on 401 and retries transient 5xx with exponential backoff. The
// adapter never imports Electron — it only needs `fetch` and `node:fs`,
// so it can be moved into a utility process in a later phase without
// touching its API.

import { createReadStream, createWriteStream, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export type TokenProvider = (forceRefresh?: boolean) => Promise<string>;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  md5Checksum?: string;
  modifiedTime?: string;
  size?: string;
}

export interface UploadResult {
  id: string;
  md5Checksum: string;
}

export class DriveError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

export class DriveAdapter {
  constructor(private readonly getToken: TokenProvider) {}

  /** Ensure a folder named `name` exists under `parentId` and return its id. */
  async ensureFolder(name: string, parentId: string | "root"): Promise<string> {
    const existing = await this.findChildByName(parentId, name, FOLDER_MIME);
    if (existing) return existing.id;

    const res = await this.fetchWithAuth(`${DRIVE_API}/files?fields=id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      }),
    });
    const json = (await res.json()) as { id: string };
    return json.id;
  }

  /** Find a single direct child by name + optional mime type. */
  async findChildByName(
    parentId: string | "root",
    name: string,
    mimeType?: string,
  ): Promise<DriveFile | null> {
    const q = [
      `'${parentId}' in parents`,
      `name = '${escapeQ(name)}'`,
      "trashed = false",
      mimeType ? `mimeType = '${mimeType}'` : "",
    ]
      .filter(Boolean)
      .join(" and ");
    const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,md5Checksum)&pageSize=1`;
    const res = await this.fetchWithAuth(url);
    const json = (await res.json()) as { files: DriveFile[] };
    return json.files?.[0] ?? null;
  }

  /** List all direct children (files + folders) of a folder, paginated. */
  async listChildren(parentId: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const q = `'${parentId}' in parents and trashed = false`;
      const params = new URLSearchParams({
        q,
        fields: "nextPageToken,files(id,name,mimeType,parents,md5Checksum,modifiedTime,size)",
        pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await this.fetchWithAuth(`${DRIVE_API}/files?${params}`);
      const json = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
      out.push(...(json.files ?? []));
      pageToken = json.nextPageToken;
    } while (pageToken);
    return out;
  }

  /**
   * Recursively list every file (no folders) under `rootId`, yielding entries
   * with their reconstructed POSIX-style relative path from the root.
   */
  async *walkFiles(
    rootId: string,
    folderCache: Map<string, string> = new Map([["", rootId]]),
  ): AsyncGenerator<{ relPath: string; file: DriveFile }> {
    type Frame = { driveId: string; relPath: string };
    const stack: Frame[] = [{ driveId: rootId, relPath: "" }];
    while (stack.length > 0) {
      const { driveId, relPath } = stack.pop()!;
      const children = await this.listChildren(driveId);
      for (const child of children) {
        const childRel = relPath === "" ? child.name : `${relPath}/${child.name}`;
        if (child.mimeType === FOLDER_MIME) {
          folderCache.set(childRel, child.id);
          stack.push({ driveId: child.id, relPath: childRel });
        } else {
          yield { relPath: childRel, file: child };
        }
      }
    }
  }

  /**
   * Idempotent create-or-update. If a file with `name` already exists under
   * `parentId`, replace its contents. Otherwise create a new file.
   * Crucial for recovering from a wiped manifest without spawning duplicates.
   */
  async createOrUpdateFile(opts: {
    name: string;
    parentId: string;
    localPath: string;
  }): Promise<UploadResult> {
    const existing = await this.findChildByName(opts.parentId, opts.name);
    if (existing) {
      return this.updateFile({ fileId: existing.id, localPath: opts.localPath });
    }
    return this.createFile(opts);
  }

  async createFile(opts: {
    name: string;
    parentId: string;
    localPath: string;
  }): Promise<UploadResult> {
    return this.resumableUpload({
      method: "POST",
      url: `${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id,md5Checksum`,
      metadata: { name: opts.name, parents: [opts.parentId] },
      localPath: opts.localPath,
    });
  }

  async updateFile(opts: { fileId: string; localPath: string }): Promise<UploadResult> {
    return this.resumableUpload({
      method: "PATCH",
      url: `${DRIVE_UPLOAD}/files/${opts.fileId}?uploadType=resumable&fields=id,md5Checksum`,
      metadata: {},
      localPath: opts.localPath,
    });
  }

  /** Stream a file's contents to `localPath`. Creates parent directories. */
  async downloadFile(driveId: string, localPath: string): Promise<void> {
    const res = await this.fetchWithAuth(`${DRIVE_API}/files/${driveId}?alt=media`);
    if (!res.body) throw new DriveError("Drive download returned no body");
    await mkdir(dirname(localPath), { recursive: true });
    const out = createWriteStream(localPath);
    // Web ReadableStream → Node Readable for stream.pipeline interop.
    await pipeline(Readable.fromWeb(res.body as unknown as import("stream/web").ReadableStream<Uint8Array>), out);
  }

  /** Permanently remove a file from Drive (skips trash). */
  async deleteFile(driveId: string): Promise<void> {
    await this.fetchWithAuth(`${DRIVE_API}/files/${driveId}`, { method: "DELETE" });
  }

  /**
   * Move (and optionally rename) a file by swapping its parents.
   * Drive doesn't accept wildcards in removeParents, so the caller must pass
   * the current parent id explicitly (we have it cached in the manifest).
   */
  async moveFile(opts: {
    fileId: string;
    oldParentId: string;
    newParentId: string;
    newName?: string;
  }): Promise<void> {
    const params = new URLSearchParams({
      addParents: opts.newParentId,
      removeParents: opts.oldParentId,
      fields: "id",
    });
    const init: RequestInit = {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts.newName ? { name: opts.newName } : {}),
    };
    await this.fetchWithAuth(`${DRIVE_API}/files/${opts.fileId}?${params}`, init);
  }

  // ---------- internals ----------

  private async resumableUpload(opts: {
    method: "POST" | "PATCH";
    url: string;
    metadata: Record<string, unknown>;
    localPath: string;
  }): Promise<UploadResult> {
    const size = statSync(opts.localPath).size;
    const mime = guessMimeType(opts.localPath);

    // Step 1: initiate the resumable session.
    const initRes = await this.fetchWithAuth(opts.url, {
      method: opts.method,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-upload-content-type": mime,
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify(opts.metadata),
    });
    const sessionUrl = initRes.headers.get("location");
    if (!sessionUrl) {
      throw new DriveError("Resumable session URL missing from Drive response");
    }

    // Step 2: PUT the bytes. Stream directly from disk — undici fetch in
    // Node 20+ accepts a Readable as body and requires duplex:"half".
    const bodyStream = createReadStream(opts.localPath);
    const putRes = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        "content-length": String(size),
        "content-type": mime,
      },
      body: bodyStream as unknown as BodyInit,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!putRes.ok) {
      const text = await putRes.text().catch(() => "");
      throw new DriveError(`Resumable upload PUT failed (${putRes.status})`, putRes.status, text);
    }
    const json = (await putRes.json()) as { id: string; md5Checksum?: string };
    // md5Checksum is missing for Google native types but always present for
    // user-uploaded binary blobs, which is the only thing we ever upload.
    return { id: json.id, md5Checksum: json.md5Checksum ?? "" };
  }

  private async fetchWithAuth(
    url: string,
    init: RequestInit = {},
    attempt = 0,
  ): Promise<Response> {
    const token = await this.getToken(attempt > 0);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });

    if (res.ok) return res;

    // Auth refresh on 401 — single retry with forced refresh.
    if (res.status === 401 && attempt === 0) {
      return this.fetchWithAuth(url, init, attempt + 1);
    }
    // Backoff on transient server errors and rate limits.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const delay = 400 * 2 ** attempt + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
      return this.fetchWithAuth(url, init, attempt + 1);
    }
    const body = await res.text().catch(() => "");
    throw new DriveError(`Drive request failed (${res.status})`, res.status, body);
  }
}

function escapeQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function guessMimeType(path: string): string {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = name.slice(dot + 1);
  const map: Record<string, string> = {
    md: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    yaml: "application/yaml",
    yml: "application/yaml",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    ts: "application/typescript",
    csv: "text/csv",
    zip: "application/zip",
  };
  return map[ext] ?? "application/octet-stream";
}
