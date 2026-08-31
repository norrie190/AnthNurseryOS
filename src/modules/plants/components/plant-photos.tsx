'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  photoImagePath,
  photoResponseSchema,
  photoTakenInstant,
  cropPreviewSchema,
  type PlantGalleryPhoto,
  type PhotoResponse,
} from '../plant-photo-browser';
import { PlantPhotoImage } from './plant-photo-image';
import { PlantPhotoCropSelector } from './plant-photo-crop-selector';
import { centredPhotoCrop, type PhotoCrop, type PhotoDimensions } from '../plant-photo-crop';
import shared from './plant-management.module.css';
import styles from './plant-photos.module.css';

const takenDate = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/London',
});
const uncertainMessage =
  'We could not confirm the photo change. Check the Plant details before trying again.';

export function PlantPhotos({
  plantId,
  reference,
  archived,
  expectedUpdatedAt,
  photos,
}: {
  plantId: string;
  reference: string;
  archived: boolean;
  expectedUpdatedAt: string;
  photos: readonly PlantGalleryPhoto[];
}) {
  const router = useRouter();
  const [token, setToken] = useState(expectedUpdatedAt);
  const [caption, setCaption] = useState('');
  const [takenAt, setTakenAt] = useState('');
  const [feedback, setFeedback] = useState<PhotoResponse | null>(null);
  const [reselect, setReselect] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const [uploadPreview, setUploadPreview] = useState<{
    src: string;
    dimensions: PhotoDimensions;
    crop: PhotoCrop;
  } | null>(null);
  const [editCrop, setEditCrop] = useState<{
    photoId: string;
    dimensions: PhotoDimensions;
    crop: PhotoCrop;
  } | null>(null);
  const [revisions, setRevisions] = useState<Record<string, string>>({});
  const [editPreviewReady, setEditPreviewReady] = useState(false);
  const fileSignature = useRef('');
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const feedbackElement = useRef<HTMLDivElement>(null);
  const busy = pending || operation !== null;
  const primary = photos.find((photo) => photo.isPrimary);
  const issues = feedback && !feedback.success ? (feedback.issues ?? []) : [];
  useEffect(() => {
    if (feedback && !feedback.success) feedbackElement.current?.focus();
  }, [feedback]);

  function send(url: string, options: RequestInit, action: string) {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setOperation(action);
    setFeedback(null);
    setReselect(false);
    startTransition(async () => {
      try {
        const response = await fetch(url, { ...options, credentials: 'same-origin' });
        const result = photoResponseSchema.parse(await response.json());
        if (!response.ok && result.success) throw new Error('Invalid photo response');
        setFeedback(result);
        if (result.success) {
          // Only our own confirmed save advances the token paired with this form.
          // A rerender after someone else's edit must not silently refresh it.
          setToken(result.plantUpdatedAt);
          if (action === 'upload') {
            setCaption('');
            setTakenAt('');
            setUploadPreview(null);
            fileSignature.current = '';
          }
          if (action === 'crop' && result.photoId && result.derivativeRevision) {
            setRevisions((current) => ({
              ...current,
              [result.photoId!]: result.derivativeRevision!,
            }));
            setEditCrop(null);
          }
          router.refresh();
        } else if (action === 'upload') setReselect(true);
      } catch {
        setFeedback({ success: false, message: uncertainMessage, checkSaved: true });
        if (action === 'upload') setReselect(true);
      } finally {
        if (action === 'upload' && fileInput.current) fileInput.current.value = '';
        inFlight.current = false;
        setOperation(null);
      }
    });
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || busy) return;
    const image = fileInput.current?.files?.[0];
    if (!image) {
      setFeedback({
        success: false,
        message: 'Choose an image to upload.',
        issues: [{ field: 'image', message: 'Select one JPEG, PNG or static WebP image.' }],
      });
      return;
    }
    if (!uploadPreview) {
      setFeedback({
        success: false,
        message: 'Select the image again to prepare its crop preview.',
      });
      return;
    }
    let instant: string | null;
    try {
      instant = photoTakenInstant(takenAt);
    } catch {
      setFeedback({
        success: false,
        message: 'Check the taken date and time.',
        issues: [{ field: 'takenAt', message: 'Enter a valid local date and time.' }],
      });
      return;
    }
    const form = new FormData(event.currentTarget);
    form.set('image', image);
    form.set('takenAt', instant ?? '');
    form.set('expectedUpdatedAt', token);
    form.set('crop', JSON.stringify(uploadPreview.crop));
    send(`/plants/${plantId}/photos`, { method: 'POST', body: form }, 'upload');
  }

  async function prepareCrop(photoId?: string) {
    if (inFlight.current || busy) return;
    if (photoId && editCrop?.photoId === photoId) return;
    const file = fileInput.current?.files?.[0];
    if (!photoId && !file) {
      setUploadPreview(null);
      return;
    }
    const previousPreview = uploadPreview;
    const signature = file ? `${file.name}:${file.size}:${file.lastModified}` : '';
    const sameFile = signature === fileSignature.current;
    if (!photoId) fileSignature.current = signature;
    if (photoId) setEditPreviewReady(false);
    inFlight.current = true;
    setOperation('preview');
    setFeedback(null);
    setReselect(false);
    if (!photoId) setUploadPreview(null);
    try {
      const body = new FormData();
      if (file) body.set('image', file);
      body.set('expectedUpdatedAt', token);
      const response = await fetch(
        photoId ? `/plants/${plantId}/photos/${photoId}/crop` : `/plants/${plantId}/photos/preview`,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          ...(photoId ? {} : { method: 'POST', body }),
        },
      );
      const data: unknown = await response.json();
      const parsed = cropPreviewSchema.safeParse(data);
      if (!response.ok || !parsed.success) {
        const failure = photoResponseSchema.parse(data);
        if (failure.success) throw new Error('Invalid preview response');
        setFeedback(failure);
        return;
      }
      const { width, height, crop, preview } = parsed.data;
      const dimensions = { width, height };
      if (photoId) setEditCrop({ photoId, dimensions, crop: crop ?? centredPhotoCrop(dimensions) });
      else {
        if (!preview) throw new Error('Missing preview');
        const retainedCrop =
          sameFile &&
          previousPreview?.dimensions.width === width &&
          previousPreview.dimensions.height === height
            ? previousPreview.crop
            : centredPhotoCrop(dimensions);
        setUploadPreview({ src: preview, dimensions, crop: retainedCrop });
      }
    } catch {
      setFeedback({
        success: false,
        message: 'The crop preview could not be prepared. Nothing was saved. Please try again.',
      });
    } finally {
      inFlight.current = false;
      setOperation(null);
    }
  }

  function saveCrop() {
    if (!editCrop || !editPreviewReady) return;
    send(
      `/plants/${plantId}/photos/${editCrop.photoId}/crop`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crop: editCrop.crop, expectedUpdatedAt: token }),
      },
      'crop',
    );
  }

  function selectPrimary(photoId: string) {
    send(
      `/plants/${plantId}/photos/${photoId}/primary`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: token }),
      },
      photoId,
    );
  }

  function fieldError(field: string) {
    const issue = issues.find((item) => item.field === field);
    return issue ? (
      <p id={`photo-${field}-error`} className={shared.fieldError}>
        {issue.message}
      </p>
    ) : null;
  }
  function details(photo: PlantGalleryPhoto) {
    return (
      <>
        {photo.caption && <p className={styles.caption}>{photo.caption}</p>}
        {photo.takenAt && (
          <p className={shared.hint}>
            Taken <time dateTime={photo.takenAt}>{takenDate.format(new Date(photo.takenAt))}</time>{' '}
            (UK time)
          </p>
        )}
      </>
    );
  }

  return (
    <section className={shared.card} aria-labelledby="photos-heading">
      <h2 id="photos-heading">Photos</h2>
      {archived && (
        <p className={shared.sectionIntro}>
          This Plant is archived. Adding photos, adjusting crops or changing its primary photo will
          not restore it or change its status.
        </p>
      )}
      {primary && (
        <figure className={styles.main}>
          <div className={styles.mainImage}>
            <PlantPhotoImage
              key={primary.id}
              src={photoImagePath(plantId, primary.id, 'display')}
              alt={primary.caption || `${reference} primary photo`}
              prominent
            />
          </div>
          <figcaption>
            <span className={shared.badge}>Primary photo</span>
            {details(primary)}
          </figcaption>
        </figure>
      )}
      {photos.length ? (
        <ul className={styles.gallery} aria-label="Plant photos">
          {photos.map((photo, index) => (
            <li key={photo.id}>
              <figure className={styles.photo}>
                <div className={styles.thumbnail}>
                  <PlantPhotoImage
                    src={photoImagePath(
                      plantId,
                      photo.id,
                      'thumbnail',
                      revisions[photo.id] ?? photo.derivativeRevision,
                    )}
                    alt={photo.caption || `${reference} photo ${index + 1}`}
                  />
                </div>
                <figcaption>
                  {photo.isPrimary ? (
                    <span className={shared.badge}>Primary</span>
                  ) : (
                    <button
                      type="button"
                      className={shared.secondaryButton}
                      disabled={busy}
                      aria-label={`Set photo ${index + 1} as Primary`}
                      onClick={() => selectPrimary(photo.id)}
                    >
                      {operation === photo.id ? 'Saving…' : 'Set as Primary'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={shared.secondaryButton}
                    disabled={busy}
                    aria-label={`Adjust Crop for photo ${index + 1}`}
                    onClick={() => void prepareCrop(photo.id)}
                  >
                    Adjust Crop
                  </button>
                  {details(photo)}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      ) : (
        <p className={shared.sectionIntro}>
          No photos yet. Add a photo to start this Plant’s gallery. The first photo becomes its
          primary image.
        </p>
      )}

      {editCrop && (
        <section aria-label="Adjust thumbnail crop" className={styles.upload}>
          <h3>Adjust Crop</h3>
          <PlantPhotoCropSelector
            key={editCrop.photoId}
            src={photoImagePath(plantId, editCrop.photoId, 'display')}
            dimensions={editCrop.dimensions}
            crop={editCrop.crop}
            onChange={(crop) => setEditCrop({ ...editCrop, crop })}
            disabled={busy}
            onReady={setEditPreviewReady}
          />
          <button
            type="button"
            className={shared.primaryButton}
            disabled={busy || !editPreviewReady}
            onClick={saveCrop}
          >
            {operation === 'crop' ? 'Saving Crop…' : 'Save Crop'}
          </button>{' '}
          <button
            type="button"
            className={shared.secondaryButton}
            disabled={busy}
            onClick={() => setEditCrop(null)}
          >
            Cancel
          </button>
        </section>
      )}

      {feedback && (
        <div
          ref={feedbackElement}
          tabIndex={-1}
          role={feedback.success ? 'status' : 'alert'}
          className={feedback.success ? shared.archiveFeedback : shared.errorSummary}
        >
          <p>{feedback.message}</p>
          {!feedback.success && issues.length > 0 && (
            <ul>
              {issues.map((issue, index) => (
                <li key={`${issue.field}-${index}`}>
                  {['image', 'caption', 'takenAt'].includes(issue.field) ? (
                    <a href={`#photo-${issue.field}`}>{issue.message}</a>
                  ) : (
                    issue.message
                  )}
                </li>
              ))}
            </ul>
          )}
          {!feedback.success && feedback.stale && (
            <p>
              Your text is still here, along with your proposed crop. Review them, then reload the
              Plant details before trying again.
            </p>
          )}
          {!feedback.success && (feedback.stale || feedback.checkSaved) && (
            <p>
              <a href={`/plants/${plantId}`}>Reload Plant details</a> to check saved photos.
              Reloading clears this form.
            </p>
          )}
          {reselect && (
            <p>
              Please select the image file again before retrying. Your caption and taken time have
              been kept.
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={upload}
        method="post"
        action={`/plants/${plantId}/photos`}
        encType="multipart/form-data"
        className={styles.upload}
        aria-label="Upload Plant photo"
        aria-busy={busy}
        noValidate
      >
        <fieldset disabled={busy} className={styles.uploadFields}>
          <legend>Upload Photo</legend>
          <p id="photo-guidance" className={shared.sectionIntro}>
            One JPEG, PNG or static WebP image, up to 10 MiB and 50 megapixels. HEIC/HEIF is not
            supported yet.
          </p>
          <div className={shared.grid}>
            <div className={`${shared.field} ${shared.fullWidth}`}>
              <label htmlFor="photo-image">Image</label>
              <input
                ref={fileInput}
                id="photo-image"
                name="image"
                type="file"
                onChange={() => void prepareCrop()}
                required
                accept="image/jpeg,image/png,image/webp"
                aria-describedby={`photo-guidance${fieldError('image') ? ' photo-image-error' : ''}`}
                aria-invalid={!!fieldError('image')}
              />
              {fieldError('image')}
              {uploadPreview && (
                <>
                  <PlantPhotoCropSelector
                    src={uploadPreview.src}
                    dimensions={uploadPreview.dimensions}
                    crop={uploadPreview.crop}
                    onChange={(crop) => setUploadPreview({ ...uploadPreview, crop })}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className={shared.secondaryButton}
                    onClick={() => {
                      setUploadPreview(null);
                      fileSignature.current = '';
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                  >
                    Cancel photo selection
                  </button>
                </>
              )}
            </div>
            <div className={shared.field}>
              <label htmlFor="photo-caption">
                Caption <span>(optional)</span>
              </label>
              <textarea
                id="photo-caption"
                name="caption"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                maxLength={2000}
                rows={3}
                aria-invalid={!!fieldError('caption')}
                aria-describedby={fieldError('caption') ? 'photo-caption-error' : undefined}
              />
              {fieldError('caption')}
            </div>
            <div className={shared.field}>
              <label htmlFor="photo-takenAt">
                Taken date and time <span>(optional)</span>
              </label>
              <input
                id="photo-takenAt"
                name="takenAt"
                type="datetime-local"
                value={takenAt}
                onChange={(event) => setTakenAt(event.target.value)}
                aria-invalid={!!fieldError('takenAt')}
                aria-describedby={`photo-time-hint${fieldError('takenAt') ? ' photo-takenAt-error' : ''}`}
              />
              <p id="photo-time-hint" className={shared.hint}>
                Uses this device’s local time. Gallery dates are shown in UK time. Leave blank if
                unknown.
              </p>
              {fieldError('takenAt')}
            </div>
          </div>
          <button className={shared.primaryButton} type="submit">
            {operation === 'upload' ? 'Uploading Photo…' : 'Upload Photo'}
          </button>
        </fieldset>
        {busy && (
          <p role="status" className={shared.hint}>
            {operation === 'preview'
              ? 'Preparing the full photo crop preview…'
              : operation === 'upload'
                ? 'Uploading and processing your photo. Please wait.'
                : 'Saving and refreshing photos…'}
          </p>
        )}
      </form>
    </section>
  );
}
