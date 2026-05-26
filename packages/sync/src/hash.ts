// Streaming MD5 — chosen because Google Drive exposes md5Checksum natively
// in file metadata, so we can compare local vs remote without downloading.
// MD5 collision resistance is not a property we need here; this is only a
// change-detection hash, not a security primitive.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function hashFile(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("md5");
    const stream = createReadStream(absPath);
    stream.on("error", reject);
    stream.on("data", (chunk) => h.update(chunk));
    stream.on("end", () => resolve(h.digest("hex")));
  });
}
