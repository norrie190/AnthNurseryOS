import { z } from 'zod';
import { PlantError } from './plant-errors';
import { plantIdSchema } from './plant-field-schemas';
import { photoCropSchema } from './plant-photo-crop';

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
  photoId: plantIdSchema,
  expectedUpdatedAt: photoTokenSchema,
});

export type UploadPlantPhotoInput = z.input<typeof uploadSchema>;
export type SetPrimaryPlantPhotoInput = z.input<typeof primarySchema>;

function parsePhotoRequest<T extends z.ZodType>(schema: T, plantId: unknown, input: unknown) {
  const result = z
    .strictObject({ plantId: plantIdSchema, input: schema })
    .safeParse({ plantId, input });
  if (result.success) return result.data;
  throw new PlantError('VALIDATION_FAILED', 'Check the supplied photo details.', {
    cause: result.error,
    issues: result.error.issues.map((issue) => ({
      field: issue.path.filter((part, index) => !(index === 0 && part === 'input')).join('.'),
      message: issue.message,
    })),
  });
}

export function parseUploadPlantPhoto(plantId: unknown, input: unknown) {
  const parsed = parsePhotoRequest(uploadSchema, plantId, input);
  // Own the bytes before the first await so caller mutations cannot alter the original
  // after it has been validated or make it disagree with the served derivatives.
  return { ...parsed, input: { ...parsed.input, image: Buffer.from(parsed.input.image) } };
}

export function parseSetPrimaryPlantPhoto(plantId: unknown, input: unknown) {
  return parsePhotoRequest(primarySchema, plantId, input);
}

const cropInputSchema = z.strictObject({
  photoId: plantIdSchema,
  crop: photoCropSchema,
  expectedUpdatedAt: photoTokenSchema,
});
export type UpdatePlantPhotoCropInput = Omit<z.input<typeof cropInputSchema>, 'photoId'>;
export function parseUpdatePlantPhotoCrop(
  plantId: unknown,
  photoId: unknown,
  input: UpdatePlantPhotoCropInput,
) {
  // Parse the input independently so an injected photoId cannot override the route.
  const body = parsePhotoRequest(cropInputSchema.omit({ photoId: true }), plantId, input);
  return parsePhotoRequest(cropInputSchema, body.plantId, { ...body.input, photoId });
}

const deletePhotoSchema = z.strictObject({
  photoId: plantIdSchema,
  expectedUpdatedAt: photoTokenSchema,
  confirmed: z.literal(true),
});
export type DeletePlantPhotoInput = Omit<z.input<typeof deletePhotoSchema>, 'photoId'>;
export function parseDeletePlantPhoto(
  plantId: unknown,
  photoId: unknown,
  input: DeletePlantPhotoInput,
) {
  const body = parsePhotoRequest(deletePhotoSchema.omit({ photoId: true }), plantId, input);
  return parsePhotoRequest(deletePhotoSchema, body.plantId, { ...body.input, photoId });
}
