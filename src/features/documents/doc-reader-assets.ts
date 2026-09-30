import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

const scripts = [
  // Expo bundles .html as an opaque local asset. The scripts are copied as .js before WebView loads them.
  ['jszip.js', require('../../../assets/doc-reader/jszip.script.html')],
  ['lodash.js', require('../../../assets/doc-reader/lodash.script.html')],
  ['konva.js', require('../../../assets/doc-reader/konva.script.html')],
  ['docx-renderer.js', require('../../../assets/doc-reader/docx-renderer.script.html')],
  ['boot.js', require('../../../assets/doc-reader/boot.script.html')],
] as const;
const activeFolders = new Set<string>();

const readerHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=0.5,maximum-scale=3,user-scalable=yes">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' file:; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: blob:; font-src 'self' file: data: blob:; connect-src 'self' file:">
<style>
  html, body { margin:0; min-height:100%; background:#e8ebef; font-family:system-ui,sans-serif; }
  #stage { margin: 12px auto 28px; position:relative; }
  #viewer { transform-origin:top left; }
  .error { padding:32px 20px; text-align:center; color:#28324a; }
</style></head><body>
<div id="stage"><div id="viewer"></div></div>
<script src="jszip.js"></script><script src="lodash.js"></script><script src="konva.js"></script><script src="docx-renderer.js"></script>
<script src="boot.js"></script></body></html>`;

/** Makes one private, disposable WebView directory; the DOCX never crosses the JS bridge. */
export async function prepareDocReader(uri: string) {
  const source = new File(uri);
  if (!source.exists) throw new Error('This document is no longer available.');
  if (source.size > 25 * 1024 * 1024) throw new Error('This DOCX is too large to display safely on this device (25 MB limit).');

  const parent = new Directory(Paths.cache, 'versara-doc-reader');
  parent.create({ intermediates: true, idempotent: true });
  for (const entry of parent.list()) {
    if (entry instanceof Directory && entry.uri.startsWith(parent.uri.replace(/\/$/, '') + '/') && !activeFolders.has(entry.uri)) {
      try { entry.delete(); } catch { /* The OS may still hold a previous WebView file. */ }
    }
  }
  const folder = new Directory(parent, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  folder.create();
  activeFolders.add(folder.uri);
  const release = () => {
    activeFolders.delete(folder.uri);
    try { if (folder.exists) folder.delete(); } catch { /* Reclaimed before the next reader opens. */ }
  };
  try {
    await source.copy(new File(folder, 'document.docx'));
    const assets = await Asset.loadAsync(scripts.map(([, module]) => module));
    for (let index = 0; index < scripts.length; index++) {
      if (!assets[index].localUri) throw new Error('A bundled reader component is missing.');
      await new File(assets[index].localUri!).copy(new File(folder, scripts[index][0]));
    }
    const page = new File(folder, 'index.html');
    page.write(readerHtml);
    return { folder, page, release };
  } catch (error) {
    release();
    throw error;
  }
}
