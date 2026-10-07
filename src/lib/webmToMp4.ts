// WebM → H.264 MP4 transcode, in the browser, via ffmpeg.wasm.
//
// Why this exists: Chrome's MediaRecorder only produces a VALID file as WebM
// (its "video/mp4" output is malformed). To hand users a real .mp4 everywhere,
// we record WebM then transcode it here.
//
// Design:
//  - SINGLE-THREADED core (@ffmpeg/core, not -mt) so we do NOT need
//    SharedArrayBuffer / cross-origin-isolation (no COOP/COEP headers, which
//    would break Privy popups and third-party embeds).
//  - Everything is dynamically imported and the ~30 MB core loads from a CDN
//    ONLY on first use, then the browser caches it and we reuse one instance.

/* eslint-disable @typescript-eslint/no-explicit-any */
let ffmpegPromise: Promise<any> | null = null;

async function getFFmpeg(onProgress?: (ratio: number) => void): Promise<any> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL } = await import('@ffmpeg/util');
      const ff = new FFmpeg();
      const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      await ff.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ff;
    })().catch((e) => { ffmpegPromise = null; throw e; });
  }
  const ff = await ffmpegPromise;
  if (onProgress) ff.on('progress', ({ progress }: { progress: number }) => onProgress(Math.max(0, Math.min(1, progress))));
  return ff;
}

export async function webmToMp4(webm: Blob, onProgress?: (ratio: number) => void): Promise<Blob> {
  const { fetchFile } = await import('@ffmpeg/util');
  const ff = await getFFmpeg(onProgress);
  const inName = 'in.webm';
  const outName = 'out.mp4';
  await ff.writeFile(inName, await fetchFile(webm));
  // H.264 + yuv420p + faststart = plays everywhere (X, Instagram, QuickTime, …).
  await ff.exec([
    '-i', inName,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-r', '30',
    outName,
  ]);
  const data = (await ff.readFile(outName)) as Uint8Array;
  try { await ff.deleteFile(inName); await ff.deleteFile(outName); } catch { /* ignore */ }
  // Copy into a fresh buffer so the blob owns its memory.
  return new Blob([data.slice()], { type: 'video/mp4' });
}
