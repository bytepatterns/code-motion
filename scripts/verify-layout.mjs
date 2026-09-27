/**
 * SAFE ZONE verification over EVERY frame of the rendered reel.
 *   node scripts/verify-layout.mjs out/bubble-sort-bars.mp4
 *
 * Streams the whole video as raw RGB through ffmpeg and, for each frame,
 * measures the bounding box of content pixels (luma > LUMA_CONTENT — above the
 * brightest decorative pixel, which is the #2B333D card border at luma ≈ 50).
 * Reports the worst-case bbox across the clip and fails if anything ever
 * escapes x:[60,900] y:[230,1400].
 */
import {spawn} from 'node:child_process';

const W = 1080;
const H = 1920;
const FRAME_BYTES = W * H * 3;
const SAFE = {left: 60, right: 900, top: 230, bottom: 1400};
const LUMA_CONTENT = 70;
const MIN_RUN = 3;

const file = process.argv[2] ?? 'out/bubble-sort-bars.mp4';

const ff = spawn('ffmpeg', [
  '-v', 'error',
  '-i', file,
  '-f', 'rawvideo',
  '-pix_fmt', 'rgb24',
  '-',
]);

let pending = Buffer.alloc(0);
let frameIdx = 0;
const worst = {minX: W, maxX: -1, minY: H, maxY: -1};
const worstAt = {minX: -1, maxX: -1, minY: -1, maxY: -1};
const violations = [];

const analyse = (buf, idx) => {
  let minX = W;
  let maxX = -1;
  let minY = H;
  let maxY = -1;
  let outside = 0;
  for (let y = 0; y < H; y++) {
    let run = 0;
    const rowBase = y * W * 3;
    for (let x = 0; x < W; x++) {
      const o = rowBase + x * 3;
      const L = 0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2];
      if (L <= LUMA_CONTENT) {
        run = 0;
        continue;
      }
      if (++run < MIN_RUN) continue;
      const px = x - MIN_RUN + 1;
      if (px < minX) minX = px;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (px < SAFE.left || x > SAFE.right || y < SAFE.top || y > SAFE.bottom) outside++;
    }
  }
  if (minX < worst.minX) {
    worst.minX = minX;
    worstAt.minX = idx;
  }
  if (maxX > worst.maxX) {
    worst.maxX = maxX;
    worstAt.maxX = idx;
  }
  if (minY < worst.minY) {
    worst.minY = minY;
    worstAt.minY = idx;
  }
  if (maxY > worst.maxY) {
    worst.maxY = maxY;
    worstAt.maxY = idx;
  }
  if (outside > 0) violations.push({idx, outside, minX, maxX, minY, maxY});
};

ff.stdout.on('data', (chunk) => {
  pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
  while (pending.length >= FRAME_BYTES) {
    analyse(pending.subarray(0, FRAME_BYTES), frameIdx++);
    pending = pending.subarray(FRAME_BYTES);
  }
});

ff.stderr.on('data', (d) => process.stderr.write(d));

ff.on('close', () => {
  console.log(`frames analysed        ${frameIdx}`);
  console.log(`worst content minX     ${worst.minX}  (frame ${worstAt.minX}) · safe left  ${SAFE.left}`);
  console.log(`worst content maxX     ${worst.maxX}  (frame ${worstAt.maxX}) · safe right ${SAFE.right}`);
  console.log(`worst content minY     ${worst.minY}  (frame ${worstAt.minY}) · safe top   ${SAFE.top}`);
  console.log(`worst content maxY     ${worst.maxY}  (frame ${worstAt.maxY}) · safe bottom ${SAFE.bottom}`);
  console.log(
    `margins                L${worst.minX - SAFE.left} R${SAFE.right - worst.maxX} ` +
      `T${worst.minY - SAFE.top} B${SAFE.bottom - worst.maxY}`
  );
  if (violations.length) {
    console.log(`\n${violations.length} frame(s) OUTSIDE the safe zone:`);
    violations.slice(0, 12).forEach((v) =>
      console.log(`  frame ${v.idx}: ${v.outside}px  bbox x:[${v.minX},${v.maxX}] y:[${v.minY},${v.maxY}]`)
    );
    process.exit(1);
  }
  console.log('\nLAYOUT OK — no content pixel leaves the safe zone on any frame.');
});
