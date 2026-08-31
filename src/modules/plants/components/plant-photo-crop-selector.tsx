'use client';

import { useId, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import {
  centredPhotoCrop,
  fitPhotoCrop,
  type PhotoCrop,
  type PhotoDimensions,
} from '../plant-photo-crop';
import styles from './plant-photo-crop-selector.module.css';
import shared from './plant-management.module.css';

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
const corners = { nw: 'top left', ne: 'top right', sw: 'bottom left', se: 'bottom right' } as const;

export function PlantPhotoCropSelector({
  src,
  dimensions,
  crop,
  onChange,
  disabled = false,
  onReady,
}: {
  src: string;
  dimensions: PhotoDimensions;
  crop: PhotoCrop;
  onChange: (crop: PhotoCrop) => void;
  disabled?: boolean;
  onReady?: (ready: boolean) => void;
}) {
  const id = useId();
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    crop: PhotoCrop;
    handle: Handle;
    width: number;
    height: number;
  } | null>(null);
  const [failedSource, setFailedSource] = useState<string>();
  const [loadedSource, setLoadedSource] = useState<string>();
  const ready = loadedSource === src && failedSource !== src;
  const { width, height } = dimensions;
  const shorter = Math.min(width, height);
  const side = crop.size * shorter;

  function begin(event: PointerEvent<HTMLButtonElement>, handle: Handle) {
    if (disabled || !ready || event.button !== 0 || drag.current) return;
    const bounds = surface.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      crop,
      handle,
      width: bounds.width,
      height: bounds.height,
    };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId || disabled) return;
    const dx = ((event.clientX - start.x) * width) / start.width;
    const dy = ((event.clientY - start.y) * height) / start.height;
    if (start.handle === 'move') {
      onChange(
        fitPhotoCrop(
          { ...start.crop, x: start.crop.x + dx / width, y: start.crop.y + dy / height },
          dimensions,
        ),
      );
      return;
    }
    const leftCorner = start.handle.endsWith('w');
    const topCorner = start.handle.startsWith('n');
    const initialSide = start.crop.size * shorter;
    const anchorX = start.crop.x * width + (leftCorner ? initialSide : 0);
    const anchorY = start.crop.y * height + (topCorner ? initialSide : 0);
    const max = Math.min(
      leftCorner ? anchorX : width - anchorX,
      topCorner ? anchorY : height - anchorY,
    );
    const nextSide = Math.max(
      Math.min(shorter * 0.01, max),
      Math.min(max, initialSide + ((leftCorner ? -dx : dx) + (topCorner ? -dy : dy)) / 2),
    );
    onChange({
      x: (anchorX - (leftCorner ? nextSide : 0)) / width,
      y: (anchorY - (topCorner ? nextSide : 0)) / height,
      size: nextSide / shorter,
    });
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, resizing = false) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = (event.shiftKey ? 0.1 : 0.01) * shorter;
    const positive = ['ArrowRight', 'ArrowDown'].includes(event.key);
    if (resizing)
      onChange(
        fitPhotoCrop(
          { ...crop, size: crop.size + (positive ? step : -step) / shorter },
          dimensions,
        ),
      );
    else
      onChange(
        fitPhotoCrop(
          {
            ...crop,
            x:
              crop.x +
              (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) / width,
            y:
              crop.y +
              (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) / height,
          },
          dimensions,
        ),
      );
  }
  const pointerEvents = {
    onPointerMove: move,
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onLostPointerCapture: () => {
      drag.current = null;
    },
  };
  return (
    <div className={styles.editor}>
      <p id={`${id}-help`} className={shared.hint}>
        Choose the area shown in thumbnails and Plant cards. Your full photo stays unchanged. Drag
        the square or its corners. Use arrow keys to move it, or the size control to resize.
      </p>
      <div
        ref={surface}
        className={styles.surface}
        style={{
          maxWidth: Math.min(520, (420 * width) / height),
          aspectRatio: `${width} / ${height}`,
        }}
      >
        {/* Both previews are oriented server WebP, rendered in original coordinate proportions. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Full photograph for thumbnail crop"
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => {
            setLoadedSource(src);
            onReady?.(true);
          }}
          onError={() => {
            setFailedSource(src);
            onReady?.(false);
          }}
        />
        {ready && (
          <div
            className={styles.square}
            style={{
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${(side / width) * 100}%`,
              height: `${(side / height) * 100}%`,
            }}
          >
            <button
              type="button"
              className={styles.move}
              aria-label="Move crop square"
              aria-describedby={`${id}-help`}
              disabled={disabled}
              onPointerDown={(event) => begin(event, 'move')}
              onKeyDown={(event) => keyboard(event)}
              {...pointerEvents}
            />
            {Object.entries(corners).map(([handle, label]) => (
              <button
                key={handle}
                type="button"
                className={`${styles.handle} ${styles[handle]}`}
                aria-label={`Resize crop ${label}`}
                disabled={disabled}
                onPointerDown={(event) => begin(event, handle as Handle)}
                onKeyDown={(event) => keyboard(event, true)}
                {...pointerEvents}
              />
            ))}
          </div>
        )}
      </div>
      {failedSource === src ? (
        <p role="alert">The crop preview could not be loaded. Cancel and try again.</p>
      ) : (
        !ready && <p role="status">Loading crop preview…</p>
      )}
      <label htmlFor={`${id}-size`}>Crop size: {Math.round(crop.size * 100)}%</label>
      <input
        id={`${id}-size`}
        type="range"
        min="1"
        max="100"
        step="1"
        value={crop.size * 100}
        disabled={disabled || !ready}
        onChange={(event) =>
          onChange(fitPhotoCrop({ ...crop, size: Number(event.target.value) / 100 }, dimensions))
        }
      />
      <button
        type="button"
        className={shared.secondaryButton}
        disabled={disabled || !ready}
        onClick={() => onChange(centredPhotoCrop(dimensions))}
      >
        Reset to centre
      </button>
    </div>
  );
}
