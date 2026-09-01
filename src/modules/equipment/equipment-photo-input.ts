import { z } from 'zod';
import { photoCropSchema } from '../../lib/photos/photo-crop';
import { MAX_PHOTO_BYTES, normalisePhotoFilename } from '../../lib/photos/photo-limits';
import { EquipmentError } from './equipment-errors';
import { equipmentIdSchema } from './equipment-input';

const photoTokenSchema = z.iso.datetime({ precision: 3 });
const uploadSchema = z.strictObject({
  image: z
    .custom<Uint8Array>((value) => value instanceof Uint8Array, 'Supply image bytes.')
    .refine(
      (bytes) => bytes.byteLength > 0 && bytes.byteLength <= MAX_PHOTO_BYTES,
      'Choose a nonempty image no larger than 10 MiB.',
    ),
  originalFilename: z.string().max(4096).transform(normalisePhotoFilename).nullish(),
  caption: z
    .string()
    .trim()
    .max(2000)
    .refine((text) => !text.includes('\0'), 'Caption cannot contain a null character.')
    .transform((text) => text || null)
    .nullish(),
  takenAt: z.iso
    .datetime({ offset: true, precision: 3 })
    .refine((date) => !date.startsWith('0000-'), 'Use a year from 0001 to 9999.')
    .nullish(),
  expectedUpdatedAt: photoTokenSchema,
  crop: photoCropSchema.optional(),
});
const primarySchema = z.strictObject({
  photoId: equipmentIdSchema,
  expectedUpdatedAt: photoTokenSchema,
});
const cropSchema = z.strictObject({
  photoId: equipmentIdSchema,
  crop: photoCropSchema,
  expectedUpdatedAt: photoTokenSchema,
});
const deleteSchema = z.strictObject({
  photoId: equipmentIdSchema,
  expectedUpdatedAt: photoTokenSchema,
  confirmed: z.literal(true),
});

export type UploadEquipmentPhotoInput = z.input<typeof uploadSchema>;
export type SetPrimaryEquipmentPhotoInput = z.input<typeof primarySchema>;
export type UpdateEquipmentPhotoCropInput = Omit<z.input<typeof cropSchema>, 'photoId'>;
export type DeleteEquipmentPhotoInput = Omit<z.input<typeof deleteSchema>, 'photoId'>;

function parsePhotoRequest<T extends z.ZodType>(schema: T, equipmentId: unknown, input: unknown) {
  const result = z
    .strictObject({ equipmentId: equipmentIdSchema, input: schema })
    .safeParse({ equipmentId, input });
  if (result.success) return result.data;
  throw new EquipmentError('VALIDATION_FAILED', 'Check the supplied Equipment photo details.', {
    cause: result.error,
    issues: result.error.issues.map((issue) => ({
      field: issue.path
        .filter((part, index) => !(index === 0 && part === 'input'))
        .map(String)
        .join('.'),
      message: issue.message,
    })),
  });
}

export function parseUploadEquipmentPhoto(equipmentId: unknown, input: unknown) {
  const parsed = parsePhotoRequest(uploadSchema, equipmentId, input);
  return { ...parsed, input: { ...parsed.input, image: Buffer.from(parsed.input.image) } };
}

export function parseSetPrimaryEquipmentPhoto(equipmentId: unknown, input: unknown) {
  return parsePhotoRequest(primarySchema, equipmentId, input);
}

export function parseUpdateEquipmentPhotoCrop(
  equipmentId: unknown,
  photoId: unknown,
  input: UpdateEquipmentPhotoCropInput,
) {
  const body = parsePhotoRequest(cropSchema.omit({ photoId: true }), equipmentId, input);
  return parsePhotoRequest(cropSchema, body.equipmentId, { ...body.input, photoId });
}

export function parseDeleteEquipmentPhoto(
  equipmentId: unknown,
  photoId: unknown,
  input: DeleteEquipmentPhotoInput,
) {
  const body = parsePhotoRequest(deleteSchema.omit({ photoId: true }), equipmentId, input);
  return parsePhotoRequest(deleteSchema, body.equipmentId, { ...body.input, photoId });
}
