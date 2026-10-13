import { supabase } from "./supabase";

/** head photos live in a public Storage bucket, one folder per user id. this
 * is the one write that goes browser -> Supabase directly rather than through
 * the API; storage RLS only lets you write under your own folder. */
const BUCKET = "avatars";

export function photoUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** stores a cropped photo and returns its path. every upload gets a fresh
 * name, so a changed photo is never served stale from a cache */
export async function uploadPhoto(userId: string, dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${userId}/${Date.now()}.${EXTENSIONS[blob.type] ?? "png"}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
  if (error) throw error;
  return path;
}

export async function removePhoto(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

/** your own photo as a data: url — the avatar export draws the svg onto a
 * canvas, and an svg rendered that way can't load a remote image */
export async function photoDataUrl(path: string): Promise<string> {
  const res = await fetch(photoUrl(path));
  if (!res.ok) throw new Error(`photo load failed (${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
