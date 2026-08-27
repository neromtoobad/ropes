/**
 * Cut a Higgsfield pose sheet into individual climber sprites.
 *
 * The sheets come back as five poses in a row on a flat background; running
 * them through remove_background first leaves transparent gaps between the
 * figures. So rather than hardcoding crop boxes per character — which would
 * break the moment a pose sits slightly differently — this finds the sprites by
 * scanning the alpha channel for columns that contain any opaque pixel, and
 * treats each run of opaque columns as one sprite.
 *
 *   npx tsx scripts/sprites.ts design/gen/green-cut.png green
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const POSES = ["climb", "slip", "leap", "fall", "cheer"] as const;

/** A column is "empty" below this alpha; anti-aliased edges are not sprites. */
const ALPHA_FLOOR = 24;
/** Ignore specks — a real sprite is far wider than this. */
const MIN_RUN_PX = 40;
/** Breathing room so a glow or a trailing cape is not sliced off. */
const PAD = 12;

const [, , input, name] = process.argv;
if (!input || !name) throw new Error("usage: sprites.ts <sheet.png> <name>");

const img = sharp(input).ensureAlpha();
const { width, height } = await img.metadata();
if (!width || !height) throw new Error("could not read sheet dimensions");

const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const channels = info.channels;

/** How many opaque pixels each column holds. Density, not just presence —
 *  neighbouring poses often overlap, so a boolean scan merges them. */
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

/** Contiguous runs of inked columns. A run may still hold several figures. */
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

/**
 * Split a run that clearly holds several overlapping figures.
 *
 * Where two poses touch, the column density dips sharply — arms and capes
 * overlap thinly while a torso is solid. So cut at the lowest-density columns,
 * keeping the pieces roughly even so a thin pose is not sliced in half.
 */
function splitRun(run: { from: number; to: number }, pieces: number) {
  const w = run.to - run.from + 1;
  const target = w / pieces;
  const cuts: number[] = [];
  for (let i = 1; i < pieces; i++) {
    const ideal = run.from + target * i;
    // Search a window around where an even split would fall.
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

/**
 * Reconcile what was found against what must be there.
 *
 * We know a sheet holds exactly five poses, so use that rather than guessing a
 * figure width from the runs themselves — estimating from the median failed on
 * a sheet whose runs had all merged into one, because then the median IS the
 * merged run and nothing looks wide enough to split.
 */
{
  const widthOf = (r: { from: number; to: number }) => r.to - r.from + 1;

  // Drop specks: a fragment the background remover left behind is a fraction of
  // a real figure and would otherwise be counted as a pose.
  const avgAll = runs.reduce((n, r) => n + widthOf(r), 0) / Math.max(runs.length, 1);
  runs = runs.filter((r) => widthOf(r) > avgAll * 0.35);

  if (runs.length < POSES.length) {
    // An average figure is the total inked width shared between the poses.
    const unit = runs.reduce((n, r) => n + widthOf(r), 0) / POSES.length;
    let pieces = runs.map((r) => Math.max(1, Math.round(widthOf(r) / unit)));

    // Force the pieces to add up to exactly five, adjusting the run whose
    // per-piece width is most out of line.
    const total = () => pieces.reduce((a, b) => a + b, 0);
    let guard = 0;
    while (total() !== POSES.length && guard++ < 20) {
      const perPiece = runs.map((r, i) => widthOf(r) / pieces[i]);
      if (total() < POSES.length) {
        const widest = perPiece.indexOf(Math.max(...perPiece));
        pieces[widest]++;
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

console.log(`${name}: found ${runs.length} figures in ${width}×${height}`);
if (runs.length !== POSES.length) {
  console.log(
    `  ⚠ expected ${POSES.length}. widths: ${runs.map((r) => r.to - r.from + 1).join(", ")}`,
  );
}

const top = rowHasInk.indexOf(true);
const bottom = rowHasInk.lastIndexOf(true);

await mkdir(`public/climbers/${name}`, { recursive: true });

for (let i = 0; i < runs.length; i++) {
  const pose = POSES[i] ?? `pose${i}`;
  const left = Math.max(0, runs[i].from - PAD);
  const right = Math.min(width - 1, runs[i].to + PAD);

  // Every pose keeps the SAME vertical extent. Trimming each sprite to its own
  // bounding box would make the character jump when the pose changes, because
  // a leap and a crouch have different heights.
  const box = {
    left,
    top: Math.max(0, top - PAD),
    width: right - left + 1,
    height: Math.min(height, bottom + PAD) - Math.max(0, top - PAD) + 1,
  };

  // A split through overlapping poses leaves a fragment of the neighbour — a
  // stray hand or cape tip that reads as a glitch on screen. It is often
  // vertically separated but shares columns with an outstretched arm, so
  // trimming edges cannot reach it. Keep only the largest connected blob.
  const crop = await sharp(input).extract(box).raw().toBuffer({ resolveWithObject: true });
  const cw = crop.info.width;
  const ch = crop.info.height;
  const cc = crop.info.channels;
  const px = crop.data;
  const opaque = (i: number) => px[i * cc + (cc - 1)] > ALPHA_FLOOR;

  const label = new Int32Array(cw * ch).fill(-1);
  let best = -1;
  let bestSize = 0;
  let next = 0;

  for (let seed = 0; seed < cw * ch; seed++) {
    if (label[seed] !== -1 || !opaque(seed)) continue;
    const id = next++;
    let size = 0;
    // Iterative flood fill; recursion would blow the stack on a 700k-pixel crop.
    const stack = [seed];
    label[seed] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % cw;
      const y = (i / cw) | 0;
      if (x > 0 && label[i - 1] === -1 && opaque(i - 1)) { label[i - 1] = id; stack.push(i - 1); }
      if (x < cw - 1 && label[i + 1] === -1 && opaque(i + 1)) { label[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && label[i - cw] === -1 && opaque(i - cw)) { label[i - cw] = id; stack.push(i - cw); }
      if (y < ch - 1 && label[i + cw] === -1 && opaque(i + cw)) { label[i + cw] = id; stack.push(i + cw); }
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }

  // Erase every blob that is not the figure.
  let erased = 0;
  for (let i = 0; i < cw * ch; i++) {
    if (label[i] !== -1 && label[i] !== best) {
      px[i * cc + (cc - 1)] = 0;
      erased++;
    }
  }

  const out = `public/climbers/${name}/${pose}.png`;
  await sharp(px, { raw: { width: cw, height: ch, channels: cc } })
    .resize({ height: 420, fit: "inside" })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`  ${pose.padEnd(6)} → ${out}  (${next} blobs, erased ${erased}px)`);
}
