import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function isExcluded(filePath, excludeGlobs) {
  const base = path.basename(filePath);
  if (excludeGlobs?.includes('**/.DS_Store') && base === '.DS_Store') return true;
  return false;
}

async function ensureRepo(root, name) {
  const gitDir = path.join(root, '.git');
  if (!(await exists(gitDir))) {
    throw new Error(`[parity] ${name} repo not found (missing .git): ${root}`);
  }
}

async function readManifest(awsRoot) {
  const manifestPath = path.join(awsRoot, 'scripts', 'parity.manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed?.paths || !Array.isArray(parsed.paths)) {
    throw new Error('[parity] Invalid manifest: missing paths[]');
  }
  return parsed;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function hashFile(absPath) {
  const data = await fs.readFile(absPath);
  return sha256(data);
}

async function listFilesRecursive(rootDir, excludeGlobs) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (isExcluded(abs, excludeGlobs)) continue;
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) out.push(abs);
    }
  }
  if (await exists(rootDir)) await walk(rootDir);
  return out.sort();
}

function toRel(abs, root) {
  return path.relative(root, abs).split(path.sep).join('/');
}

async function compareFile(srcAbs, destAbs, label) {
  const [srcHash, destHash] = await Promise.all([hashFile(srcAbs), hashFile(destAbs)]);
  if (srcHash !== destHash) throw new Error(`[parity] File differs: ${label}`);
}

async function compareDir(srcAbs, destAbs, excludeGlobs, label) {
  const [srcFilesAbs, destFilesAbs] = await Promise.all([
    listFilesRecursive(srcAbs, excludeGlobs),
    listFilesRecursive(destAbs, excludeGlobs),
  ]);
  const srcFiles = srcFilesAbs.map((p) => toRel(p, srcAbs));
  const destFiles = destFilesAbs.map((p) => toRel(p, destAbs));
  const srcSet = new Set(srcFiles);
  const destSet = new Set(destFiles);
  const missing = srcFiles.filter((f) => !destSet.has(f));
  const extra = destFiles.filter((f) => !srcSet.has(f));
  if (missing.length || extra.length) {
    throw new Error(`[parity] Directory file list differs: ${label}`);
  }
  for (let i = 0; i < srcFilesAbs.length; i += 1) {
    const rel = srcFiles[i];
    await compareFile(srcFilesAbs[i], path.join(destAbs, rel), `${label}/${rel}`);
  }
}

async function main() {
  const awsRoot = process.cwd();
  await ensureRepo(awsRoot, 'dinodia-platform-aws');

  const platformRoot = path.resolve(awsRoot, '..', 'dinodia-platform');
  await ensureRepo(platformRoot, 'dinodia-platform');

  const manifest = await readManifest(awsRoot);
  const excludeGlobs = Array.isArray(manifest.excludeGlobs) ? manifest.excludeGlobs : [];

  for (const entry of manifest.paths) {
    const mode = entry?.mode;
    const srcRel = entry?.src;
    const destRel = entry?.dest;
    const srcAbs = path.join(platformRoot, srcRel);
    const destAbs = path.join(awsRoot, destRel);
    if (mode === 'file') {
      if (!(await exists(srcAbs))) throw new Error(`[parity] Missing source file: ${srcRel}`);
      if (!(await exists(destAbs))) throw new Error(`[parity] Missing dest file: ${destRel}`);
      await compareFile(srcAbs, destAbs, destRel);
    } else if (mode === 'dir') {
      await compareDir(srcAbs, destAbs, excludeGlobs, destRel);
    } else {
      throw new Error(`[parity] Unknown mode "${mode}" for ${srcRel}`);
    }
  }

  process.stdout.write('[parity] OK: all manifest entries match.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

