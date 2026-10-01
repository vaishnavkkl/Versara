import { Directory, File, Paths } from 'expo-file-system';
import type { PdfMark } from '../../../modules/pdf-engine/src/PdfMarkupView';

const MAX_SIGNATURES = 6;
const MAX_STROKES = 200;
const MAX_POINTS = 8000;

type Stroke = Pick<PdfMark, 'kind' | 'brush' | 'color' | 'width' | 'opacity' | 'pattern'> & { points: [number, number][] };
type Base = { id: string; used: number; aspect: number; pageWidth: number };
/** `aspect` is the signature's width / height on paper; `pageWidth` its width as a fraction of the page. */
export type RecentSignature = (Base & { kind: 'image'; image: string; pixels: string; backgroundRemoved: boolean })
  | (Base & { kind: 'drawn'; strokes: Stroke[] });

const folder = () => new Directory(Paths.document, 'Versara Signatures');
const indexFile = () => new File(folder(), 'index.json');
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let cache: RecentSignature[] | null = null;
let writes: Promise<unknown> = Promise.resolve();

function valid(value: unknown): value is RecentSignature {
  if (!value || typeof value !== 'object') return false;
  const entry = value as RecentSignature;
  if (typeof entry.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(entry.id) || !Number.isFinite(entry.used)) return false;
  if (!(entry.aspect > 0.02 && entry.aspect < 50) || !(entry.pageWidth > 0 && entry.pageWidth <= 1)) return false;
  if (entry.kind === 'image') return /^[a-z0-9-]+\.png$/.test(entry.image) && entry.pixels === `${entry.image}.bgra`;
  return entry.kind === 'drawn' && Array.isArray(entry.strokes) && entry.strokes.length > 0 && entry.strokes.length <= MAX_STROKES
    && entry.strokes.every(stroke => Array.isArray(stroke.points) && stroke.points.length >= 2 && typeof stroke.color === 'string' && Number.isFinite(stroke.width));
}

export async function listRecentSignatures(): Promise<RecentSignature[]> {
  if (cache) return cache;
  try {
    const file = indexFile();
    const parsed = file.exists ? JSON.parse(await file.text()) as unknown : [];
    cache = (Array.isArray(parsed) ? parsed.filter(valid) : [])
      .filter(entry => entry.kind === 'drawn' || (new File(folder(), entry.image).exists && new File(folder(), entry.pixels).exists))
      .sort((a, b) => b.used - a.used).slice(0, MAX_SIGNATURES);
  } catch { cache = []; }
  return cache;
}

function deleteAssets(entry: RecentSignature) {
  if (entry.kind !== 'image') return;
  for (const name of [entry.image, entry.pixels]) try { const file = new File(folder(), name); if (file.exists) file.delete(); } catch { /* Next save retries. */ }
}

async function persist(next: RecentSignature[]) {
  const sorted = [...next].sort((a, b) => b.used - a.used);
  for (const dropped of sorted.slice(MAX_SIGNATURES)) deleteAssets(dropped);
  cache = sorted.slice(0, MAX_SIGNATURES);
  const snapshot = JSON.stringify(cache);
  writes = writes.catch(() => {}).then(() => { folder().create({ intermediates: true, idempotent: true }); indexFile().write(snapshot); });
  await writes;
  return cache;
}

export async function removeRecentSignature(id: string) {
  const current = await listRecentSignatures();
  const entry = current.find(item => item.id === id);
  if (entry) deleteAssets(entry);
  return persist(current.filter(item => item.id !== id));
}

const bounds = (points: [number, number][]) => {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
};

/**
 * Remembers the signatures in a saved PDF: each image as the version that was used (background removed or not),
 * and the strokes drawn on each page as one drawn signature. `pageAspect` is the page width / height.
 */
export async function rememberSignatures(marks: PdfMark[], pageAspect: number) {
  const current = await listRecentSignatures();
  const next = [...current];
  const now = Date.now();
  const touched = new Set<string>();
  const touch = (id: string) => { const entry = next.find(item => item.id === id); if (entry && !touched.has(id)) { touched.add(id); entry.used = now + touched.size; } return !!entry; };

  const images = new Map<string, PdfMark>();
  for (const mark of marks) if (mark.kind === 'image' && mark.imageUri && mark.pixelPath) {
    if (mark.signatureId && touch(mark.signatureId)) continue;
    images.set(`${mark.originalImageUri}|${mark.backgroundRemoved ? 1 : 0}`, mark);
  }
  for (const mark of images.values()) {
    try {
      const id = newId(), image = `${id}.png`;
      folder().create({ intermediates: true, idempotent: true });
      await new File(mark.imageUri!).copy(new File(folder(), image));
      // Native signature assets keep their pixels next to the PNG.
      await new File(`${mark.imageUri}.bgra`).copy(new File(folder(), `${image}.bgra`));
      const box = bounds(mark.points), width = box.right - box.left, height = box.bottom - box.top;
      next.push({ id, kind: 'image', used: now + touched.size + next.length, image, pixels: `${image}.bgra`, backgroundRemoved: !!mark.backgroundRemoved, pageWidth: Math.min(1, width), aspect: width * pageAspect / Math.max(1e-6, height) });
    } catch { /* A signature that cannot be copied is simply not remembered. */ }
  }

  const drawn = new Map<number, PdfMark[]>();
  for (const mark of marks) if (mark.kind !== 'image') {
    if (mark.signatureId && touch(mark.signatureId)) continue;
    drawn.set(mark.page, [...(drawn.get(mark.page) ?? []), mark]);
  }
  for (const strokes of drawn.values()) {
    if (strokes.length > MAX_STROKES || strokes.reduce((sum, mark) => sum + mark.points.length, 0) > MAX_POINTS) continue;
    const box = bounds(strokes.flatMap(mark => mark.points));
    const width = Math.max(1e-4, box.right - box.left), height = Math.max(1e-4, box.bottom - box.top);
    next.push({ id: newId(), kind: 'drawn', used: now + touched.size + next.length, pageWidth: Math.min(1, width), aspect: width * pageAspect / height,
      strokes: strokes.map(mark => ({ kind: mark.kind, brush: mark.brush, color: mark.color, width: mark.width, opacity: mark.opacity, pattern: mark.pattern,
        points: mark.points.map(([x, y]) => [(x - box.left) / width, (y - box.top) / height] as [number, number]) })) });
  }
  if (!touched.size && next.length === current.length) return current;
  return persist(next);
}

/** Placement centred on the page for a page whose width / height is `pageAspect`, kept inside the page. */
export function signaturePlacement(entry: RecentSignature, pageAspect: number) {
  let width = Math.min(entry.pageWidth, 0.6), height = width * pageAspect / entry.aspect;
  if (height > 0.4) { width *= 0.4 / height; height = 0.4; }
  return { left: (1 - width) / 2, top: (1 - height) / 2, width, height };
}

/** Image signatures are copied into the draft folder the native editor reads from. */
export async function prepareImageSignature(entry: Extract<RecentSignature, { kind: 'image' }>) {
  const drafts = new Directory(Paths.document, 'Versara Signature Drafts');
  drafts.create({ intermediates: true, idempotent: true });
  const name = `signature-${newId()}.png`;
  const image = new File(drafts, name), pixels = new File(drafts, `${name}.bgra`);
  await new File(folder(), entry.image).copy(image);
  await new File(folder(), entry.pixels).copy(pixels);
  return { uri: image.uri, pixelPath: decodeURIComponent(pixels.uri.replace(/^file:\/\//, '')) };
}

export const signatureImageUri = (entry: Extract<RecentSignature, { kind: 'image' }>) => new File(folder(), entry.image).uri;
