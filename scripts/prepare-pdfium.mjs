// Reproducible native dependencies. No downloaded code is executed.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../modules/pdf-engine');
const vendor = join(root, 'vendor');
const version = 'chromium/8066';
const hashes = {
  'android-arm': '0812590de0a652f3c6620263316374a97134d8c0157ad1867005e53cf87e30c5',
  'android-arm64': 'a665e3a9d40fb0024e3959261a400a722a13f7aa6602c59a82c93d44a362c055',
  'android-x64': '44b9444d58f055ab892019aea27423bab74d671a37b5bad84647a91abec82a1d',
  'android-x86': '458d8316bab4fa83332b0fb7f4cb4524be61e3b1b6f0f994fb86af6e303b0074',
  'ios-device-arm64': '0b4c5e0a6a4e9e6102ca832b704a676b1bbd5fb7ae7ba23caeb91bbca305a952',
  'ios-simulator-arm64': 'db5b87b7137e52a7e9c11eb8cf9b0f921144fb915c802c4a4e37443e6a084f9d',
  'ios-simulator-x64': '748649d63cc145d970f0087c401d243d867e8a2c8e4558ae56ff7f8f0ff44e29',
};
mkdirSync(vendor, { recursive: true });
async function download(target) {
  const destination = join(vendor, target);
  const marker = join(destination, '.verified');
  if (existsSync(marker) && readFileSync(marker, 'utf8') === hashes[target]) return;
  const url = `https://github.com/bblanchon/pdfium-binaries/releases/download/${version}/pdfium-${target}.tgz`;
  console.log(`Downloading PDFium ${version}: ${target}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`PDFium download failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== hashes[target]) throw new Error(`PDFium checksum mismatch: ${target}`);
  const archive = join(vendor, `${target}.tgz`);
  writeFileSync(archive, data);
  mkdirSync(destination, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', destination]);
  writeFileSync(marker, hashes[target]);
}
const iosOnly = process.argv.includes('--ios');
const androidOnly = process.argv.includes('--android');
const targets = Object.keys(hashes).filter(name => iosOnly ? name.startsWith('ios') : androidOnly || process.platform !== 'darwin' ? name.startsWith('android') : true);
await Promise.all(targets.map(download));
if (targets.some(name => name.startsWith('android'))) {
  const licenses = join(vendor, 'android-assets/licenses/pdfium');
  mkdirSync(licenses, { recursive: true });
  cpSync(join(vendor, 'android-arm64/licenses'), licenses, { recursive: true });
  copyFileSync(join(vendor, 'android-arm64/LICENSE'), join(licenses, 'BINARY-DISTRIBUTION-LICENSE'));
  for (const name of ['JSON-LICENSE', 'STB-LICENSE']) copyFileSync(join(root, 'cpp/third_party', name), join(licenses, name));
}
// CocoaPods must embed dynamic iOS libraries as signed frameworks.
if ((iosOnly || !androidOnly) && process.platform === 'darwin') {
  const output = join(vendor, 'PDFium.xcframework');
  if (!existsSync(output)) {
    const frameworks = [];
    for (const platform of ['device', 'simulator']) {
      const framework = join(vendor, `ios-${platform}`, 'PDFium.framework');
      mkdirSync(join(framework, 'Headers'), { recursive: true });
      cpSync(join(vendor, 'ios-device-arm64/include'), join(framework, 'Headers'), { recursive: true });
      const binary = join(framework, 'PDFium');
      if (platform === 'device') copyFileSync(join(vendor, 'ios-device-arm64/lib/libpdfium.dylib'), binary);
      else execFileSync('lipo', ['-create', join(vendor, 'ios-simulator-arm64/lib/libpdfium.dylib'), join(vendor, 'ios-simulator-x64/lib/libpdfium.dylib'), '-output', binary]);
      execFileSync('install_name_tool', ['-id', '@rpath/PDFium.framework/PDFium', binary]);
      writeFileSync(join(framework, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.versara.pdfium</string><key>CFBundleExecutable</key><string>PDFium</string><key>CFBundleName</key><string>PDFium</string><key>CFBundlePackageType</key><string>FMWK</string><key>CFBundleVersion</key><string>8066</string><key>CFBundleShortVersionString</key><string>1.0</string><key>MinimumOSVersion</key><string>17.0</string></dict></plist>`);
      frameworks.push('-framework', framework);
    }
    execFileSync('xcodebuild', ['-create-xcframework', ...frameworks, '-output', output], { stdio: 'inherit' });
  }
}
