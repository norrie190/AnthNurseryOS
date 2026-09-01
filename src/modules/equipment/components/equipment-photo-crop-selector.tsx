'use client';

import type { ComponentProps } from 'react';
import { PhotoCropSelector } from '../../../components/photos/photo-crop-selector';

export function EquipmentPhotoCropSelector(
  props: Omit<ComponentProps<typeof PhotoCropSelector>, 'helpText'>,
) {
  return (
    <PhotoCropSelector
      {...props}
      helpText="Choose the area shown in thumbnails and Equipment cards. Your full photo stays unchanged. Drag the square or its corners. Use arrow keys to move it, or the size control to resize."
    />
  );
}
