import { z } from 'zod';
import { photoCropSchema } from '../../lib/photos/photo-crop';

export type EquipmentGalleryPhoto = {
  id: string;
  caption: string | null;
  takenAt: string | null;
  isPrimary: boolean;
  derivativeRevision?: string | null;
};

export const equipmentPhotoResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    message: z.string(),
    equipmentUpdatedAt: z.iso.datetime(),
    photoId: z.uuid().optional(),
    derivativeRevision: z.uuid().optional(),
    deletedPhotoId: z.uuid().optional(),
    primaryPhotoId: z.uuid().nullable().optional(),
    cleanupPending: z.boolean().optional(),
  }),
  z.object({
    success: z.literal(false),
    message: z.string(),
    issues: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
    stale: z.boolean().optional(),
    checkSaved: z.boolean().optional(),
  }),
]);
export type EquipmentPhotoResponse = z.infer<typeof equipmentPhotoResponseSchema>;

export function equipmentPhotoImagePath(
  equipmentId: string,
  photoId: string,
  variant: 'display' | 'thumbnail',
  revision?: string | null,
) {
  const path = `/equipment/${encodeURIComponent(equipmentId)}/photos/${encodeURIComponent(photoId)}/${variant}`;
  return variant === 'thumbnail' && revision ? `${path}?v=${encodeURIComponent(revision)}` : path;
}

export const equipmentCropPreviewSchema = z.object({
  success: z.literal(true),
  width: z.number().int().positive().max(50_000_000),
  height: z.number().int().positive().max(50_000_000),
  crop: photoCropSchema.nullable().optional(),
  preview: z.string().startsWith('data:image/webp;base64,').optional(),
});

export function equipmentPhotoTakenInstant(value: string): string | null {
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
