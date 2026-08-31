export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 50_000_000;

export function normalisePhotoFilename(value: string): string | null {
  const basename = value.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const cleaned = Array.from(basename)
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return code >= 32 && !(code >= 127 && code <= 159);
    })
    .join('')
    .trim();
  const name = Array.from(cleaned).slice(0, 255).join('').trim();
  return !name || name === '.' || name === '..' ? null : name;
}
