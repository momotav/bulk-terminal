// X serves profile pictures as a 48px "_normal" thumbnail by default, which turns to
// mush at any real size. The same URL with "_400x400" is the full-quality original.
export function hiResAvatar(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.replace(/_(normal|bigger|mini)(\.[a-z]+)?$/i, '_400x400$2');
}
