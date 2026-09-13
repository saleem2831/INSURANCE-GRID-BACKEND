import fs from "fs/promises";
import path from "path";

function safeFileName(fileName: string): string {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function gridUploadDirectory(): string {
  const configured = process.env.GRID_UPLOAD_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "uploads", "grids");
}

export async function persistGridFile(
  buffer: Buffer,
  fileName: string,
  fileHash: string
): Promise<{ storagePath: string; alreadyOnDisk: boolean }> {
  const directory = gridUploadDirectory();
  await fs.mkdir(directory, { recursive: true });

  const storagePath = path.join(
    directory,
    `${fileHash}-${safeFileName(fileName)}`
  );

  try {
    await fs.access(storagePath);
    return { storagePath, alreadyOnDisk: true };
  } catch {
    await fs.writeFile(storagePath, buffer);
    return { storagePath, alreadyOnDisk: false };
  }
}

export async function readStoredGridFile(storagePath: string): Promise<Buffer> {
  return fs.readFile(storagePath);
}

export async function deleteStoredGridFile(storagePath: string): Promise<void> {
  try {
    await fs.unlink(storagePath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function storedGridFileExists(storagePath?: string | null): Promise<boolean> {
  if (!storagePath) return false;
  try {
    await fs.access(storagePath);
    return true;
  } catch {
    return false;
  }
}
