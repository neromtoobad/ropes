/**
 * Cut a Higgsfield climb-cycle strip into animation frames.
 *
 * Same algorithm as sprites.ts (column-density valleys, shared vertical
 * extent, largest-blob cleanup) but for a 6-frame hand-over-hand cycle.
 * Each frame keeps its own rope segment — on the wall it overlays the CSS
 * rope's column, reading as the gripped section of the same strand.
 *
 *   npx tsx scripts/cycle.ts <strip.png> <name>   -> public/climbers/<name>/cycle/{0..5}.png
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const FRAMES = 6;
const ALPHA_FLOOR = 24;
const MIN_RUN_PX = 40;
const PAD = 12;

const [, , input, name] = process.argv;
if (!input || !name) throw new Error("usage: cycle.ts <strip.png> <name>");

const img = sharp(input).ensureAlpha();
const meta = await img.metadata();
const width = meta.width!;
const height = meta.height!;

const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const channels = info.channels;

const inkPerCol = new Array<number>(width).fill(0);
const rowHasInk = new Array<boolean>(height).fill(false);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * channels + (channels - 1)];
    if (alpha > ALPHA_FLOOR) {
      inkPerCol[x]++;
      rowHasInk[y] = true;
    }
  }
}

let runs: { from: number; to: number }[] = [];
let start: number | null = null;
for (let x = 0; x <= width; x++) {
  const ink = x < width && inkPerCol[x] > 0;
  if (ink && start === null) start = x;
  if (!ink && start !== null) {
    if (x - start >= MIN_RUN_PX) runs.push({ from: start, to: x - 1 });
    start = null;
  }
}

function splitRun(run: { from: number; to: number }, pieces: number) {
  const w = run.to - run.from + 1;
  const target = w / pieces;
  const cuts: number[] = [];
  for (let i = 1; i < pieces; i++) {
    const ideal = run.from + target * i;
    const lo = Math.round(ideal - target * 0.35);
    const hi = Math.round(ideal + target * 0.35);
    let best = ideal;
    let bestInk = Infinity;
    for (let x = lo; x <= hi; x++) {
      if (x <= run.from || x >= run.to) continue;
      if (inkPerCol[x] < bestInk) {
        bestInk = inkPerCol[x];
        best = x;
      }
    }
    cuts.push(Math.round(best));
  }
  const bounds = [run.from, ...cuts, run.to];
  return bounds.slice(0, -1).map((from, i) => ({ from, to: bounds[i + 1] }));
}

{
  const widthOf = (r: { from: number; to: number }) => r.to - r.from + 1;
  const avgAll = runs.reduce((n, r) => n + widthOf(r), 0) / Math.max(runs.length, 1);
  runs = runs.filter((r) => widthOf(r) > avgAll * 0.35);

  if (runs.length < FRAMES) {
    const unit = runs.reduce((n, r) => n + widthOf(r), 0) / FRAMES;
    const pieces = runs.map((r) => Math.max(1, Math.round(widthOf(r) / unit)));
    const total = () => pieces.reduce((a, b) => a + b, 0);
    let guard = 0;
    while (total() !== FRAMES && guard++ < 20) {
      const perPiece = runs.map((r, i) => widthOf(r) / pieces[i]);
      if (total() < FRAMES) {
        pieces[perPiece.indexOf(Math.max(...perPiece))]++;
      } else {
        const narrowest = perPiece
          .map((w, i) => ({ w, i }))
          .filter(({ i }) => pieces[i] > 1)
          .sort((a, b) => a.w - b.w)[0];
        if (!narrowest) break;
        pieces[narrowest.i]--;
      }
    }
    runs = runs.flatMap((r, i) => (pieces[i] > 1 ? splitRun(r, pieces[i]) : [r]));
  }
}

console.log(`${name}: found ${runs.length} frames in ${width}×${height}`);
if (runs.length !== FRAMES) {
  console.log(`  ⚠ expected ${FRAMES}. widths: ${runs.map((r) => r.to - r.from + 1).join(", ")}`);
}

const top = rowHasInk.indexOf(true);
const bottom = rowHasInk.lastIndexOf(true);

await mkdir(`public/climbers/${name}/cycle`, { recursive: true });

for (let i = 0; i < Math.min(runs.length, FRAMES); i++) {
  const left = Math.max(0, runs[i].from - PAD);
  const right = Math.min(width - 1, runs[i].to + PAD);
  // Clamp hard: the baked ropes run to the strip's edges, so bottom+PAD can
  // overflow the image (sprites.ts never hit this — figures floated clear).
  const boxTop = Math.max(0, top - PAD);
  const box = {
    left,
    top: boxTop,
    width: right - left + 1,
    height: Math.min(height - 1, bottom + PAD) - boxTop + 1,
  };

  const crop = await sharp(input).extract(box).raw().toBuffer({ resolveWithObject: true });
  const cw = crop.info.width;
  const ch = crop.info.height;
  const cc = crop.info.channels;
  const px = crop.data;
  const opaque = (j: number) => px[j * cc + (cc - 1)] > ALPHA_FLOOR;

  const label = new Int32Array(cw * ch).fill(-1);
  let best = -1;
  let bestSize = 0;
  let next = 0;
  for (let seed = 0; seed < cw * ch; seed++) {
    if (label[seed] !== -1 || !opaque(seed)) continue;
    const id = next++;
    let size = 0;
    const stack = [seed];
    label[seed] = id;
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      const x = j % cw;
      const y = (j / cw) | 0;
      if (x > 0 && label[j - 1] === -1 && opaque(j - 1)) { label[j - 1] = id; stack.push(j - 1); }
      if (x < cw - 1 && label[j + 1] === -1 && opaque(j + 1)) { label[j + 1] = id; stack.push(j + 1); }
      if (y > 0 && label[j - cw] === -1 && opaque(j - cw)) { label[j - cw] = id; stack.push(j - cw); }
      if (y < ch - 1 && label[j + cw] === -1 && opaque(j + cw)) { label[j + cw] = id; stack.push(j + cw); }
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }

  let erased = 0;
  for (let j = 0; j < cw * ch; j++) {
    if (label[j] !== -1 && label[j] !== best) {
      px[j * cc + (cc - 1)] = 0;
      erased++;
    }
  }

  await sharp(px, { raw: { width: cw, height: ch, channels: cc as 4 } })
    .png()
    .toFile(`public/climbers/${name}/cycle/${i}.png`);
  console.log(
    `  frame ${i}: ${cw}×${ch}${erased ? `  (erased ${erased}px of neighbours)` : ""}`,
  );
}
