/**
 * Uploaded files (building photos, KYC documents, credit evidence).
 *
 * Blobs live in the storage driver; links the UI opens directly (a document's
 * "View") are object URLs, prepared at boot so serializers can stay synchronous.
 */
import { database } from "../context";
import { randomId } from "../util";

const urls = new Map<string, string>();

function urlFor(id: string, blob: Blob) {
  const previous = urls.get(id);
  if (previous) URL.revokeObjectURL(previous);
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export function fileUrl(id: string): string {
  return urls.get(id) ?? "#";
}

export async function saveFile(blob: Blob): Promise<string> {
  const id = randomId("file_");
  await database().driver.putFile(id, blob);
  urlFor(id, blob);
  return id;
}

export async function readFile(id: string | null): Promise<Blob | null> {
  if (!id) return null;
  return database().driver.getFile(id);
}

export async function deleteFile(id: string | null) {
  if (!id) return;
  await database().driver.deleteFile(id);
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
}

/** Give every stored document a URL so "View" links work after a reload. */
export async function prepareFileUrls() {
  const db = database();
  for (const doc of db.tables.documents) {
    if (urls.has(doc.file_id)) continue;
    const blob = await db.driver.getFile(doc.file_id);
    if (blob) urlFor(doc.file_id, blob);
  }
}
