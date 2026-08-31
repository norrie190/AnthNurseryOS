import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PlantPhotos } from './plant-photos';
import type { PlantGalleryPhoto } from '../plant-photo-browser';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const props = {
  plantId: 'plant-id',
  reference: 'ANT-0001',
  archived: false,
  expectedUpdatedAt: '2026-08-31T12:00:00.000Z',
  photos: [] as PlantGalleryPhoto[],
};
const photos: PlantGalleryPhoto[] = [
  { id: 'first', caption: 'First leaf', takenAt: '2026-08-31T12:00:00.000Z', isPrimary: true },
  { id: 'second', caption: null, takenAt: null, isPrimary: false },
];
const nextToken = '2026-08-31T12:00:00.001Z';
const fetchMock = vi.fn();
const previewMock = vi.fn();
function success(message = 'Photo uploaded.') {
  return { ok: true, json: async () => ({ success: true, message, plantUpdatedAt: nextToken }) };
}
function file() {
  return new File(['synthetic content'], 'leaf.jpg', { type: 'image/jpeg' });
}
beforeEach(() => {
  vi.clearAllMocks();
  previewMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      width: 400,
      height: 600,
      preview: 'data:image/webp;base64,ZmFrZQ==',
    }),
  });
  vi.stubGlobal('fetch', (url: string, options: RequestInit) =>
    url.endsWith('/preview') ? previewMock(url, options) : fetchMock(url, options),
  );
  fetchMock.mockResolvedValue(success());
});
afterEach(() => vi.unstubAllGlobals());

test('empty gallery offers a single file input with guidance and optional details', () => {
  render(<PlantPhotos {...props} />);
  expect(screen.getByText(/No photos yet/)).toBeInTheDocument();
  const input = screen.getByLabelText('Image');
  expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  expect(input).not.toHaveAttribute('multiple');
  expect(screen.getByText(/10 MiB and 50 megapixels/)).toHaveTextContent(
    'HEIC/HEIF is not supported yet',
  );
  expect(screen.getByLabelText(/Caption/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Taken date and time/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
});

test('missing file focuses its field error without contacting the server or suggesting a reload', async () => {
  const user = userEvent.setup();
  render(<PlantPhotos {...props} />);
  await user.type(screen.getByLabelText(/Caption/), 'Draft caption');
  await user.click(screen.getByRole('button', { name: 'Upload Photo' }));
  const summary = screen.getByRole('alert');
  expect(summary).toHaveFocus();
  expect(summary).toHaveTextContent('Choose an image to upload');
  expect(
    within(summary).queryByRole('link', { name: 'Reload Plant details' }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Caption/)).toHaveValue('Draft caption');
  expect(fetchMock).not.toHaveBeenCalled();
});
test('gallery shows prominent primary, ordered thumbnails, caption/date and primary actions', () => {
  render(<PlantPhotos {...props} photos={photos} />);
  const images = screen.getAllByRole('img');
  expect(images).toHaveLength(3);
  expect(images[0]).toHaveAttribute('src', '/plants/plant-id/photos/first/display');
  expect(images[0]).toHaveAttribute('loading', 'eager');
  const gallery = screen.getByRole('list', { name: 'Plant photos' });
  expect(within(gallery).getAllByRole('listitem')).toHaveLength(2);
  expect(within(gallery).getByText('Primary')).toBeInTheDocument();
  expect(within(gallery).getByText('First leaf')).toBeInTheDocument();
  expect(within(gallery).getByText('31 Aug 2026, 13:00')).toHaveAttribute(
    'datetime',
    photos[0].takenAt,
  );
  expect(screen.queryByRole('button', { name: 'Set photo 1 as Primary' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Set photo 2 as Primary' })).toBeEnabled();
});
test('upload sends one file and approved metadata, then clears the form and refreshes', async () => {
  const user = userEvent.setup();
  render(<PlantPhotos {...props} />);
  await user.upload(screen.getByLabelText('Image'), file());
  await user.type(screen.getByLabelText(/Caption/), 'New leaf');
  fireEvent.change(screen.getByLabelText(/Taken date and time/), {
    target: { value: '2026-08-30T13:45' },
  });
  await user.click(screen.getByRole('button', { name: 'Upload Photo' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('/plants/plant-id/photos');
  expect(options.credentials).toBe('same-origin');
  expect([...options.body.keys()].sort()).toEqual([
    'caption',
    'crop',
    'expectedUpdatedAt',
    'image',
    'takenAt',
  ]);
  expect(options.body.get('caption')).toBe('New leaf');
  expect(options.body.get('takenAt')).toBe(new Date('2026-08-30T13:45').toISOString());
  expect(options.body.get('expectedUpdatedAt')).toBe(props.expectedUpdatedAt);
  expect(options.body.get('image').name).toBe('leaf.jpg');
  expect(screen.getByRole('status')).toHaveTextContent('Photo uploaded.');
  expect(screen.getByLabelText(/Caption/)).toHaveValue('');
  expect((screen.getByLabelText('Image') as HTMLInputElement).files).toHaveLength(0);
});
test('pending upload disables all photo mutations and ordinary repeated submissions', async () => {
  let finish!: (value: ReturnType<typeof success>) => void;
  fetchMock.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  render(<PlantPhotos {...props} photos={photos} />);
  await user.upload(screen.getByLabelText('Image'), file());
  await user.click(screen.getByRole('button', { name: 'Upload Photo' }));
  expect(screen.getByRole('button', { name: 'Uploading Photo…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Set photo 2 as Primary' })).toBeDisabled();
  expect(screen.getByLabelText(/Caption/)).toBeDisabled();
  fireEvent.submit(screen.getByRole('form', { name: 'Upload Plant photo' }));
  expect(fetchMock).toHaveBeenCalledOnce();
  await act(async () => finish(success()));
  expect(screen.getByRole('button', { name: 'Upload Photo' })).toBeEnabled();
});
test('validation feedback focuses an accessible summary, retains text and asks to reselect the file', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    json: async () => ({
      success: false,
      message: 'Check caption',
      issues: [{ field: 'caption', message: 'Caption is invalid' }],
    }),
  });
  const user = userEvent.setup();
  render(<PlantPhotos {...props} />);
  await user.upload(screen.getByLabelText('Image'), file());
  await user.type(screen.getByLabelText(/Caption/), 'Keep this');
  fireEvent.change(screen.getByLabelText(/Taken date and time/), {
    target: { value: '2026-08-30T13:45' },
  });
  await user.click(screen.getByRole('button', { name: 'Upload Photo' }));
  const summary = await screen.findByRole('alert');
  expect(summary).toHaveFocus();
  expect(summary).toHaveTextContent('Please select the image file again');
  expect(within(summary).getByRole('link', { name: 'Caption is invalid' })).toHaveAttribute(
    'href',
    '#photo-caption',
  );
  expect(screen.getByLabelText(/Caption/)).toHaveValue('Keep this');
  expect(screen.getByLabelText(/Caption/)).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText(/Taken date and time/)).toHaveValue('2026-08-30T13:45');
  expect((screen.getByLabelText('Image') as HTMLInputElement).files).toHaveLength(0);
  expect(refresh).not.toHaveBeenCalled();
});
test.each(['network', 'non-json', 'invalid-contract'])(
  'unexpected %s failure shows safe check-before-retry guidance',
  async (failure) => {
    if (failure === 'network') fetchMock.mockRejectedValue(new Error('secret transport error'));
    else
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => {
          if (failure === 'non-json') throw new Error('secret');
          return { raw: 'secret' };
        },
      });
    const user = userEvent.setup();
    render(<PlantPhotos {...props} />);
    await user.upload(screen.getByLabelText('Image'), file());
    await user.click(screen.getByRole('button', { name: 'Upload Photo' }));
    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('Check the Plant details before trying again');
    expect(summary).not.toHaveTextContent('secret');
    expect(refresh).not.toHaveBeenCalled();
  },
);
test('switches primary using the token, refreshes the gallery and retains unsaved upload text', async () => {
  fetchMock.mockResolvedValue(success('Primary photo saved.'));
  const user = userEvent.setup();
  const view = render(<PlantPhotos {...props} photos={photos} />);
  await user.type(screen.getByLabelText(/Caption/), 'Next photo draft');
  await user.click(screen.getByRole('button', { name: 'Set photo 2 as Primary' }));
  expect(fetchMock).toHaveBeenCalledWith(
    '/plants/plant-id/photos/second/primary',
    expect.objectContaining({
      body: JSON.stringify({ expectedUpdatedAt: props.expectedUpdatedAt }),
    }),
  );
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  view.rerender(
    <PlantPhotos
      {...props}
      expectedUpdatedAt={nextToken}
      photos={photos.map((photo) => ({ ...photo, isPrimary: photo.id === 'second' }))}
    />,
  );
  expect(screen.getAllByRole('img')[0]).toHaveAttribute(
    'src',
    '/plants/plant-id/photos/second/display',
  );
  expect(screen.getByLabelText(/Caption/)).toHaveValue('Next photo draft');
  await user.upload(screen.getByLabelText('Image'), file());
  await user.click(screen.getByRole('button', { name: 'Upload Photo' }));
  expect(fetchMock.mock.calls[1][1].body.get('expectedUpdatedAt')).toBe(nextToken);
});
test('stale primary failure keeps submitted values and does not adopt a token from another edit', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    json: async () => ({ success: false, stale: true, message: 'Plant changed since loading' }),
  });
  const user = userEvent.setup();
  const view = render(<PlantPhotos {...props} photos={photos} />);
  await user.type(screen.getByLabelText(/Caption/), 'Keep draft');
  view.rerender(<PlantPhotos {...props} photos={photos} expectedUpdatedAt={nextToken} />);
  await user.click(screen.getByRole('button', { name: 'Set photo 2 as Primary' }));
  expect(fetchMock.mock.calls[0][1].body).toBe(
    JSON.stringify({ expectedUpdatedAt: props.expectedUpdatedAt }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Your text is still here');
  expect(screen.getByLabelText(/Caption/)).toHaveValue('Keep draft');
  expect(refresh).not.toHaveBeenCalled();
});
test('archived Plants retain galleries and both photo controls with explicit archive guidance', async () => {
  const user = userEvent.setup();
  render(<PlantPhotos {...props} archived photos={photos} />);
  expect(screen.getByText(/will not restore it or change its status/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload Photo' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Set photo 2 as Primary' }));
  expect(fetchMock).toHaveBeenCalledOnce();
});
test('failed gallery image becomes a neutral fallback without hiding metadata/actions', () => {
  render(<PlantPhotos {...props} photos={photos} />);
  fireEvent.error(screen.getAllByRole('img')[0]);
  expect(screen.getByRole('img', { name: 'Photo unavailable: First leaf' })).toBeInTheDocument();
  expect(screen.getByText('Primary photo')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Set photo 2 as Primary' })).toBeEnabled();
});

test('upload sends centred crop from server oriented dimensions and can cancel without saving', async () => {
  const user = userEvent.setup();
  render(<PlantPhotos {...props} />);
  await user.upload(screen.getByLabelText('Image'), file());
  expect(previewMock).toHaveBeenCalledOnce();
  fireEvent.load(await screen.findByRole('img', { name: 'Full photograph for thumbnail crop' }));
  expect(screen.getByRole('slider')).toHaveValue('100');
  await user.click(screen.getByRole('button', { name: 'Cancel photo selection' }));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  await user.upload(screen.getByLabelText('Image'), file());
  await user.click(screen.getByRole('button', { name: 'Upload Photo' }));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body.get('crop'))).toEqual({
    x: 0,
    y: 1 / 6,
    size: 1,
  });
});

const cropPhotoId = 'b38a77d2-a221-4429-85e3-0b4b1c066758';
const cropPhotos = [{ ...photos[0], id: cropPhotoId }];
const savedCrop = { x: 0.1, y: 0.2, size: 0.5 };
function cropPreviewResponse(crop: typeof savedCrop | null = savedCrop) {
  return { ok: true, json: async () => ({ success: true, width: 400, height: 600, crop }) };
}
test.each([false, true])(
  'saved crop opens and cancel makes no mutation (archived %s)',
  async (archived) => {
    fetchMock.mockResolvedValueOnce(cropPreviewResponse());
    const user = userEvent.setup();
    render(<PlantPhotos {...props} photos={cropPhotos} archived={archived} />);
    await user.click(screen.getByRole('button', { name: 'Adjust Crop for photo 1' }));
    fireEvent.load(await screen.findByRole('img', { name: 'Full photograph for thumbnail crop' }));
    expect(screen.getByRole('slider')).toHaveValue('50');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  },
);
test('legacy crop starts centred; save refreshes thumbnail only and sends restricted input', async () => {
  const revision = 'e2fd4eb8-a916-4b6a-901c-0f501f1abf88';
  fetchMock.mockResolvedValueOnce(cropPreviewResponse(null)).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      success: true,
      message: 'Thumbnail crop saved.',
      plantUpdatedAt: nextToken,
      photoId: cropPhotoId,
      derivativeRevision: revision,
    }),
  });
  const user = userEvent.setup();
  render(<PlantPhotos {...props} photos={cropPhotos} />);
  const display = screen.getAllByRole('img')[0].getAttribute('src');
  await user.click(screen.getByRole('button', { name: 'Adjust Crop for photo 1' }));
  fireEvent.load(await screen.findByRole('img', { name: 'Full photograph for thumbnail crop' }));
  expect(screen.getByRole('slider')).toHaveValue('100');
  fireEvent.change(screen.getByRole('slider'), { target: { value: '50' } });
  await user.click(screen.getByRole('button', { name: 'Save Crop' }));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    crop: { x: 0, y: 1 / 6, size: 0.5 },
    expectedUpdatedAt: props.expectedUpdatedAt,
  });
  expect(screen.getAllByRole('img')[0]).toHaveAttribute('src', display);
  expect(
    within(screen.getByRole('list', { name: 'Plant photos' })).getByRole('img'),
  ).toHaveAttribute('src', `/plants/plant-id/photos/${cropPhotoId}/thumbnail?v=${revision}`);
  expect(refresh).toHaveBeenCalledOnce();
});
test('pending crop blocks mutations and a stale failure retains the selection and token', async () => {
  let finish!: (value: unknown) => void;
  fetchMock.mockResolvedValueOnce(cropPreviewResponse()).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  const view = render(<PlantPhotos {...props} photos={cropPhotos} />);
  await user.click(screen.getByRole('button', { name: 'Adjust Crop for photo 1' }));
  fireEvent.load(await screen.findByRole('img', { name: 'Full photograph for thumbnail crop' }));
  fireEvent.change(screen.getByRole('slider'), { target: { value: '60' } });
  view.rerender(<PlantPhotos {...props} photos={cropPhotos} expectedUpdatedAt={nextToken} />);
  await user.click(screen.getByRole('button', { name: 'Save Crop' }));
  expect(screen.getByRole('button', { name: 'Saving Crop…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Upload Photo' })).toBeDisabled();
  await act(async () =>
    finish({
      ok: false,
      json: async () => ({ success: false, stale: true, message: 'Plant changed.' }),
    }),
  );
  expect(screen.getByRole('slider')).toHaveValue('60');
  expect(screen.getByRole('alert')).toHaveTextContent('proposed crop');
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).expectedUpdatedAt).toBe(
    props.expectedUpdatedAt,
  );
  expect(refresh).not.toHaveBeenCalled();
});
