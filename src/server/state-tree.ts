import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export interface TreeEntry {
  key: string;
  path: string;
  content: string;
}

export async function loadTextTree(root: string): Promise<TreeEntry[]> {
  const files: TreeEntry[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push({
          key: `f${files.length}`,
          path: relative(root, fullPath),
          content: await readFile(fullPath, "utf8"),
        });
      }
    }
  }

  await walk(root);
  return files;
}
