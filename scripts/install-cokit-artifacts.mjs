// Installs artifacts from the pinned, manual GitHub Actions source build.
// No executable code is downloaded or run by this script.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const revision = '5ae1c42aee3b09be881c5a3a97c0581f63404505';
const vendor = resolve(dirname(fileURLToPath(import.meta.url)), '../modules/doc-engine/vendor/cokit');
mkdirSync(vendor, { recursive: true });

function inside(path) {
  const resolved = resolve(path);
  if (!resolved.startsWith(`${vendor}${sep}`)) throw new Error(`Path outside COKit vendor directory: ${resolved}`);
  return resolved;
}

function checkArchiveEntries(archive, kind) {
  const names = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  if (!names.length) throw new Error(`Empty archive: ${archive}`);
  for (const name of names) {
    const parts = name.replace(/\\/g, '/').split('/').filter(Boolean);
    if (isAbsolute(name) || parts[0] !== kind || parts.some(part => part === '..')) {
      throw new Error(`Unsafe archive entry: ${name}`);
    }
  }
}

function checkTree(path) {
  for (const entry of readdirSync(path)) {
    const child = inside(join(path, entry));
    const type = lstatSync(child);
    if (type.isSymbolicLink()) throw new Error(`Symbolic link in artifact: ${child}`);
    if (type.isDirectory()) checkTree(child);
    else if (!type.isFile()) throw new Error(`Unsupported artifact entry: ${child}`);
  }
}

function install(archive) {
  const name = archive.toLowerCase();
  const kind = name.includes('android') ? 'android' : name.includes('ios') ? 'ios' : null;
  if (!kind) throw new Error(`Expected an Android or iOS COKit archive: ${archive}`);
  const stage = inside(join(vendor, `.staging-${randomUUID()}`));
  const target = inside(join(vendor, kind));
  const backup = inside(join(vendor, `.backup-${randomUUID()}`));
  checkArchiveEntries(archive, kind);
  mkdirSync(stage);
  try {
    execFileSync('tar', ['-xJf', archive, '-C', stage], { stdio: 'inherit' });
    const unpacked = inside(join(stage, kind));
    checkTree(unpacked);
    const actualRevision = readFileSync(join(unpacked, 'REVISION'), 'utf8').trim();
    if (actualRevision !== revision) throw new Error(`Wrong COKit source revision: ${actualRevision}`);
    const required = kind === 'android'
      ? ['arm64-v8a/liblo-native-code.so', 'assets/program']
      : ['libCOKit.a', 'resources/program'];
    for (const file of required) {
      if (!existsSync(join(unpacked, file))) throw new Error(`Missing ${kind} engine file: ${file}`);
    }
    if (!existsSync(join(unpacked, 'THIRDPARTYLICENSES'))) throw new Error('Missing third-party license notices');
    if (existsSync(target)) renameSync(target, backup);
    try { renameSync(unpacked, target); }
    catch (error) {
      if (existsSync(backup)) renameSync(backup, target);
      throw error;
    }
    if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
    process.stdout.write(`Installed ${kind} COKit runtime from ${revision}.\n`);
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv.length < 3) {
  throw new Error('Usage: node scripts/install-cokit-artifacts.mjs <android.tar.xz> [ios.tar.xz]');
}
for (const archive of process.argv.slice(2)) install(resolve(archive));
