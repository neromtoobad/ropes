"use client";

/**
 * The share card: a run's result drawn to a canvas, copied to the clipboard
 * as a PNG (with a download fallback). No server, no image service — the
 * browser draws its own trophy.
 */
export async function shareRunCard(opts: {
  name: string;
  climber: string;
  multiple: number;
  rounds: number;
  status: string; // "banked" | "eliminated"
}): Promise<"copied" | "downloaded"> {
  const W = 1000;
  const H = 625;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const won = opts.status !== "eliminated" && opts.multiple >= 1;
  const gold = "#e8b33d";
  const accent = opts.status === "eliminated" ? "#ff5d73" : won ? "#3ddc84" : gold;

  // the slate-violet surface, with a soft vignette
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#171528");
  bg.addColorStop(1, "#0b0a13");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // corner ticks — the HUD frame travels with the trophy
  ctx.strokeStyle = gold;
  ctx.lineWidth = 3;
  for (const [x, y, dx, dy] of [
    [24, 24, 1, 1],
    [W - 24, 24, -1, 1],
    [24, H - 24, 1, -1],
    [W - 24, H - 24, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * 28, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * 28);
    ctx.stroke();
  }

  // milestone ledge lines, faint
  ctx.strokeStyle = "#ffffff14";
  ctx.setLineDash([8, 14]);
  for (const y of [140, 260, 380, 500]) {
    ctx.beginPath();
    ctx.moveTo(60, y);
    ctx.lineTo(W - 60, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const sprite = new Image();
  sprite.src = `/climbers/${opts.climber}/${opts.status === "eliminated" ? "slip" : "cheer"}.webp`;
  await new Promise((res) => {
    sprite.onload = res;
    sprite.onerror = res;
  });
  if (sprite.width) {
    const sh = 300;
    const sw = (sprite.width / sprite.height) * sh;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 40;
    ctx.drawImage(sprite, W - sw - 110, H - sh - 90, sw, sh);
    ctx.shadowBlur = 0;
  }

  ctx.fillStyle = "#8a86a3";
  ctx.font = "800 22px 'Chakra Petch', sans-serif";
  ctx.fillText("T H E   C L I M B", 70, 90);

  ctx.fillStyle = accent;
  ctx.font = "400 170px 'Russo One', sans-serif";
  ctx.shadowColor = accent;
  ctx.shadowBlur = 60;
  ctx.fillText(`${opts.multiple.toFixed(2)}×`, 62, 300);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#eeecf5";
  ctx.font = "400 44px 'Russo One', sans-serif";
  ctx.fillText(
    opts.status === "eliminated" ? "FELL AT THE BELL" : "BAILED IN TIME",
    70,
    380,
  );

  ctx.fillStyle = "#8a86a3";
  ctx.font = "800 26px 'Chakra Petch', sans-serif";
  ctx.fillText(
    `${opts.name.toUpperCase()} · ${opts.rounds} ROUND${opts.rounds === 1 ? "" : "S"} SURVIVED`,
    70,
    430,
  );
  ctx.fillText("EVERY METRE WAS REAL MONEY ON A REAL ORDER BOOK", 70, 520);
  ctx.fillStyle = gold;
  ctx.fillText("BTC · 1 MINUTE · SOMNIA × DREAMDEX", 70, 560);

  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "copied";
  } catch {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `the-climb-${opts.multiple.toFixed(2)}x.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    return "downloaded";
  }
}
