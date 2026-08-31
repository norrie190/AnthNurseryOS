// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import * as shared from '../../src/lib/photos/photo-keys';
import * as plant from '../../src/modules/plants/plant-photo-keys';

vi.mock('server-only', () => ({}));
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const asset = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const revision = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const original = `plants/${owner}/${asset}/original.jpg`;

test('existing literal Plant original, display, legacy thumbnail and revision paths are unchanged', () => {
  expect(plant.parsePhotoStorageKey(original)).toEqual({
    plantId: owner,
    assetId: asset,
    extension: 'jpg',
  });
  expect(plant.photoAssetPrefix(original)).toBe(`plants/${owner}/${asset}/`);
  expect(plant.photoVariantKey(original, 'display', revision)).toBe(
    `plants/${owner}/${asset}/display.webp`,
  );
  expect(plant.photoVariantKey(original, 'thumbnail', null)).toBe(
    `plants/${owner}/${asset}/thumbnail.webp`,
  );
  expect(plant.photoVariantKey(original, 'thumbnail', revision)).toBe(
    `plants/${owner}/${asset}/thumbnails/${revision}.webp`,
  );
});
test.each(['jpg', 'png', 'webp'] as const)(
  'Plant generation retains namespace and detected %s extension',
  (extension) => {
    const keys = plant.createPhotoKeys(owner.toUpperCase(), extension, revision);
    const parsed = plant.parsePhotoStorageKey(keys.original);
    expect(parsed).toMatchObject({ plantId: owner, extension });
    expect(parsed.assetId).toMatch(/^[a-f0-9-]{36}$/);
    expect(keys.display).toBe(`plants/${owner}/${parsed.assetId}/display.webp`);
    expect(keys.thumbnail).toBe(`plants/${owner}/${parsed.assetId}/thumbnails/${revision}.webp`);
    expect(plant.createPhotoKeys(owner, extension).original).not.toBe(keys.original);
  },
);
test.each(['plants', 'equipment'] as const)(
  '%s keys require matching scope, even for identical owner/asset UUIDs',
  (namespace) => {
    const own = `${namespace}/${owner}/${asset}/original.png`;
    const other = `${namespace === 'plants' ? 'equipment' : 'plants'}/${owner}/${asset}/original.png`;
    expect(shared.parsePhotoStorageKey(namespace, own)).toMatchObject({
      namespace,
      ownerId: owner,
    });
    expect(() => shared.parsePhotoStorageKey(namespace, other)).toThrow();
    expect(() => shared.photoVariantKey(namespace, other, 'display')).toThrow();
    expect(() => shared.assertPhotoObjectKey(namespace, other)).toThrow();
    expect(() => shared.assertPhotoAssetObjectKey(namespace, own, other)).toThrow();
  },
);
test('Plant wrapper rejects every Equipment companion and original', () => {
  const keys = shared.createPhotoKeys('equipment', owner, 'jpg', revision);
  for (const key of [
    ...Object.values(keys),
    shared.photoVariantKey('equipment', keys.original, 'thumbnail'),
  ]) {
    expect(() => plant.assertPhotoObjectKey(key)).toThrow();
    expect(() => plant.assertPhotoAssetObjectKey(original, key)).toThrow();
  }
  expect(() => plant.parsePhotoStorageKey(keys.original)).toThrow();
  expect(() => plant.photoAssetPrefix(keys.original)).toThrow();
  expect(() => plant.photoVariantKey(keys.original, 'thumbnail')).toThrow();
});
test.each(['photos', 'media', 'plants/../equipment', '', 'PLANTS'])(
  'unknown namespace %j is rejected at runtime',
  (namespace) => {
    const bad = namespace as shared.PhotoNamespace;
    expect(() => shared.createPhotoKeys(bad, owner, 'jpg')).toThrow();
    expect(() => shared.parsePhotoStorageKey(bad, original)).toThrow();
    expect(() => shared.assertPhotoObjectKey(bad, original)).toThrow();
  },
);
test.each([
  `plants/invalid/${asset}/original.jpg`,
  `plants/${owner}/invalid/original.jpg`,
  `plants/${owner}/${asset}/thumbnails/invalid.webp`,
  `plants/${owner}/${asset}/thumbnails/${revision}.webp/extra`,
  `plants/${owner}/${asset}/original.jpg\n`,
  `plants/${owner}/${asset}/../original.jpg`,
  `plants/${owner}/${asset}/original.gif`,
  `plants/${owner}/${asset}/display.webp?key=anything`,
  `plants/${owner}/${asset}/original.jpg/extra`,
  `plants/${owner}/${asset}/original.jpg%00`,
  `equipment/${owner}/${asset}/original.jpg`,
  `https://example.invalid/${original}`,
])('Plant rejects malformed/foreign object %s', (key) =>
  expect(() => plant.assertPhotoObjectKey(key)).toThrow(),
);
test('asset cleanup cannot accept an owner prefix or adjacent asset', () => {
  for (const prefix of ['plants/', `plants/${owner}/`, `plants/${owner}/${asset}/`])
    expect(() => plant.photoAssetPrefix(prefix)).toThrow();
  expect(() =>
    plant.assertPhotoAssetObjectKey(original, `plants/${owner}/${randomUUID()}/display.webp`),
  ).toThrow();
  expect(() => plant.photoVariantKey(original, 'original' as shared.PhotoVariant)).toThrow();
  expect(() => plant.createPhotoKeys(owner, 'jpg', 'bad-revision')).toThrow();
});
