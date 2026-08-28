/**
 * Align every cycle frame so the ROPE sits at the exact horizontal center,
 * and extract a rope-only tile from the real artwork.
 *
 * Why: frames were bounding-box cropped independently, so the baked rope's x
 * drifts frame to frame (the character's reach pulls the box around). On
 * screen that read as the rope wiggling sideways. Centering on the rope
 * fixes the strand in place — the BODY moves around it, which is how
 * climbing actually looks — and lets a tile of the same artwork continue
 * the strand to the summit with zero mismatch: same pixels, same twist.
 *
 *   npx tsx scripts/ropealign.ts     -> rewrites cycle frames + rope.png per character
 */
import sharp from "sharp";

const CHARS = ["green", "red", "gold", "blue", "violet", "orange", "teal", "pink"];
const ALPHA_FLOOR = 24;

for (const c of CHARS) {
  let bestTile: { frame: number; headroom: number; lo: number; hi: number } | null = null;

  for (let f = 0; f < 6; f++) {
    const p = `public/climbers/${c}/cycle/${f}.png`;
    const src = sharp(p).ensureAlpha();
    const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: ch } = info;

    // The rope's span in the very top rows — nothing else lives up there.
    let lo = w;
    let hi = -1;
    for (let y = 0; y < Math.min(30, h); y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * ch + ch - 1] > ALPHA_FLOOR) {
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
      }
    }
    if (hi < 0) {
      console.log(`${c}/${f}: no rope at the top edge — skipped`);
      continue;
    }
    const ropeW = hi - lo + 1;
    const cx = (lo + hi) / 2;

    // Headroom: how far down the rope runs before the body appears (the
    // first row noticeably wider than the rope). Best tile = most headroom.
    let headroom = h;
    for (let y = 0; y < h; y++) {
      let rowLo = w;
      let rowHi = -1;
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * ch + ch - 1] > ALPHA_FLOOR) {
          if (x < rowLo) rowLo = x;
          if (x > rowHi) rowHi = x;
        }
      }
      if (rowHi - rowLo + 1 > ropeW * 2.5 + 8) {
        headroom = y;
        break;
      }
    }

    // Re-canvas so the rope's center IS the frame's center.
    const half = Math.max(cx, w - cx) + 4;
    const newW = Math.ceil(half * 2);
    const left = Math.round(half - cx);
    const buf = await sharp(p).png().toBuffer();
    await sharp({
      create: { width: newW, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: buf, left, top: 0 }])
      .png()
      .toFile(`${p}.tmp.png`);
    const { rename } = await import("node:fs/promises");
    await rename(`${p}.tmp.png`, p);

    // Track the frame with the deepest rope-only stretch for the tile —
    // measured in the ALIGNED frame's coordinates.
    const alo = Math.round(left + lo);
    const ahi = Math.round(left + hi);
    if (!bestTile || headroom > bestTile.headroom) bestTile = { frame: f, headroom, lo: alo, hi: ahi };
    console.log(`${c}/${f}: rope ${ropeW}px @ x=${Math.round(cx)} → centered in ${newW}px, headroom ${headroom}px`);
  }

  if (bestTile && bestTile.headroom > 60) {
    const p = `public/climbers/${c}/cycle/${bestTile.frame}.png`;
    const meta = await sharp(p).metadata();
    const pad = 6;
    const tile = {
      left: Math.max(0, bestTile.lo - pad),
      top: 0,
      width: Math.min(meta.width! - Math.max(0, bestTile.lo - pad), bestTile.hi - bestTile.lo + 1 + pad * 2),
      height: Math.min(bestTile.headroom - 4, 320),
    };
    await sharp(p).extract(tile).png().toFile(`public/climbers/${c}/rope.png`);
    console.log(`${c}: rope tile from frame ${bestTile.frame} — ${tile.width}×${tile.height}`);
  } else {
    console.log(`${c}: ⚠ not enough rope headroom for a tile`);
  }
}
