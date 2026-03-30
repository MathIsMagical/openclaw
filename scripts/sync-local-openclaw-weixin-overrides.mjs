import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const localPluginRoot = path.join(os.homedir(), ".openclaw", "extensions", "openclaw-weixin");
const repoOverridesRoot = path.join(repoRoot, "tools", "local-overrides", "openclaw-weixin");

const managedRelativePaths = [
  "src/messaging/jiuyan-data-ops-intent.ts",
  "src/messaging/jiuyan-data-ops.ts",
  "src/messaging/process-message.ts",
];

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyManagedFiles({ sourceRoot, destRoot }) {
  for (const relPath of managedRelativePaths) {
    const sourcePath = path.join(sourceRoot, relPath);
    const destPath = path.join(destRoot, relPath);
    if (!(await fileExists(sourcePath))) {
      throw new Error(`Missing source file: ${sourcePath}`);
    }
    await ensureParent(destPath);
    await fs.copyFile(sourcePath, destPath);
    console.log(`${sourcePath} -> ${destPath}`);
  }
}

async function main() {
  const mode = process.argv[2] ?? "--capture";
  if (mode !== "--capture" && mode !== "--apply") {
    throw new Error(
      "Usage: node scripts/sync-local-openclaw-weixin-overrides.mjs [--capture|--apply]",
    );
  }

  if (mode === "--capture") {
    await copyManagedFiles({
      sourceRoot: localPluginRoot,
      destRoot: repoOverridesRoot,
    });
    console.log("Captured local weixin overrides into repo.");
    return;
  }

  await copyManagedFiles({
    sourceRoot: repoOverridesRoot,
    destRoot: localPluginRoot,
  });
  console.log("Applied repo-managed weixin overrides into local plugin.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
