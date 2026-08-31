import { z } from 'zod';
import { photoCropSchema } from './plant-photo-crop';

// This browser contract contains no storage keys or provider URLs.
export type PlantGalleryPhoto = {
  id: string;
  caption: string | null;
  takenAt: string | null;
  isPrimary: boolean;
  derivativeRevision?: string | null;
};

export const photoResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    message: z.string(),
    plantUpdatedAt: z.iso.datetime(),
    photoId: z.uuid().optional(),
    derivativeRevision: z.uuid().optional(),
  }),
  z.object({
    success: z.literal(false),
    message: z.string(),
    issues: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
    stale: z.boolean().optional(),
    checkSaved: z.boolean().optional(),
  }),
]);
export type PhotoResponse = z.infer<typeof photoResponseSchema>;

export function photoImagePath(
  plantId: string,
  photoId: string,
  variant: 'display' | 'thumbnail',
  revision?: string | null,
) {
  const path = `/plants/${encodeURIComponent(plantId)}/photos/${encodeURIComponent(photoId)}/${variant}`;
  return variant === 'thumbnail' && revision ? `${path}?v=${encodeURIComponent(revision)}` : path;
}

export const cropPreviewSchema = z.object({
  success: z.literal(true),
  width: z.number().int().positive().max(50_000_000),
  height: z.number().int().positive().max(50_000_000),
  crop: photoCropSchema.nullable().optional(),
  preview: z.string().startsWith('data:image/webp;base64,').optional(),
});

// datetime-local has no timezone. Interpret it on the device that collected it,
// rejecting calendar rollover and nonexistent local times during a DST change.
export function photoTakenInstant(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('Enter a valid date and time.');
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number);
  const date = new Date(value);
  if (
    year < 1 ||
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  )
    throw new Error(
      'Enter a valid local date and time. This time may not exist when clocks change.',
    );
  return date.toISOString();
}
