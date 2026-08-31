import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PlantPhotoCropSelector } from './plant-photo-crop-selector';
import { centredPhotoCrop, photoCropPixels } from '../plant-photo-crop';

const dimensions = { width: 400, height: 600 };
function Editor({ disabled = false }: { disabled?: boolean }) {
  const [crop, setCrop] = useState(centredPhotoCrop(dimensions));
  return (
    <>
      <PlantPhotoCropSelector
        src="/preview.webp"
        dimensions={dimensions}
        crop={crop}
        onChange={setCrop}
        disabled={disabled}
      />
      <output data-testid="crop">{JSON.stringify(crop)}</output>
    </>
  );
}
const capture = Object.getOwnPropertyDescriptor(Element.prototype, 'setPointerCapture');
beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, options: PointerEventInit = {}) {
      super(type, options);
      this.pointerId = options.pointerId ?? 1;
      this.pointerType = options.pointerType ?? 'mouse';
    }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 200,
    height: 300,
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 200,
    bottom: 300,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (capture) Object.defineProperty(Element.prototype, 'setPointerCapture', capture);
  else Reflect.deleteProperty(Element.prototype, 'setPointerCapture');
});
function open(disabled = false) {
  render(<Editor disabled={disabled} />);
  fireEvent.load(screen.getByRole('img'));
}
const value = () => JSON.parse(screen.getByTestId('crop').textContent!);

test('centred default has accessible controls and full photograph guidance', () => {
  open();
  expect(value()).toEqual(centredPhotoCrop(dimensions));
  expect(screen.getByText(/Your full photo stays unchanged/)).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Crop size: 100%' })).toHaveValue('100');
  expect(screen.getAllByRole('button', { name: /Resize crop/ })).toHaveLength(4);
});
test.each(['mouse', 'touch'])(
  '%s movement maps the scaled preview to the same oriented coordinates',
  (pointerType) => {
    open();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '50' } });
    const target = screen.getByRole('button', { name: 'Move crop square' });
    fireEvent.pointerDown(target, {
      pointerId: 1,
      pointerType,
      clientX: 50,
      clientY: 60,
      button: 0,
    });
    fireEvent.pointerMove(target, { pointerId: 1, pointerType, clientX: 70, clientY: 90 });
    fireEvent.pointerUp(target, { pointerId: 1, pointerType });
    expect(value().x).toBeCloseTo(0.1);
    expect(value().y).toBeCloseTo(1 / 6 + 0.1);
    expect(photoCropPixels(value(), dimensions)).toEqual({
      left: 40,
      top: 160,
      width: 200,
      height: 200,
    });
  },
);
test.each(['top left', 'top right', 'bottom left', 'bottom right'])(
  'corner %s keeps a square inside the image',
  (corner) => {
    open();
    const handle = screen.getByRole('button', { name: `Resize crop ${corner}` });
    const left = corner.includes('left');
    const top = corner.includes('top');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: left ? 120 : 80,
      clientY: top ? 120 : 80,
    });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(value().size).toBeCloseTo(0.9);
    expect(photoCropPixels(value(), dimensions).width).toBe(360);
  },
);
test('keyboard movement, size control and reset work without dragging', async () => {
  const user = userEvent.setup();
  open();
  fireEvent.change(screen.getByRole('slider'), { target: { value: '50' } });
  const target = screen.getByRole('button', { name: 'Move crop square' });
  target.focus();
  await user.keyboard('{ArrowRight}{ArrowDown}');
  expect(value().x).toBeCloseTo(0.01);
  expect(value().y).toBeCloseTo(1 / 6 + 4 / 600);
  await user.click(screen.getByRole('button', { name: 'Reset to centre' }));
  expect(value()).toEqual(centredPhotoCrop(dimensions));
});
test('pending state disables keyboard and pointer controls', () => {
  open(true);
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  expect(screen.getByRole('slider')).toBeDisabled();
});
test('preview failure shows guidance instead of an interactive invisible crop', () => {
  render(<Editor />);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('alert')).toHaveTextContent('Cancel and try again');
  expect(screen.queryByRole('button', { name: 'Move crop square' })).not.toBeInTheDocument();
});
