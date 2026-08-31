import sharp from 'sharp';

// Synthetic local fixtures, never nursery photos or downloaded images. Keeping the
// recipes here makes orientation and animation cases reproducible without binaries.
export function photoFixture(
  format: 'jpeg' | 'png' | 'webp' | 'gif' | 'tiff' = 'png',
  width = 16,
  height = 12,
) {
  return sharp({ create: { width, height, channels: 3, background: '#447744' } })
    .toFormat(format)
    .toBuffer();
}

export function orientedPhotoFixture() {
  return sharp({ create: { width: 400, height: 200, channels: 3, background: '#447744' } })
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Artist: 'PRIVATE CAMERA OWNER' },
      IFD2: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '51/1 30/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 7/1 0/1',
      },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">PRIVATE LOCATION</x:xmpmeta>')
    .jpeg()
    .toBuffer();
}

export function animatedPhotoFixture() {
  const data = Buffer.alloc(4 * 8 * 3);
  data.fill(255, 4 * 4 * 3);
  return sharp(data, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
}
