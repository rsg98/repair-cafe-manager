/**
 * @file src/utils/imageCompression.ts
 *
 * Client-Side Image Compression & EXIF Stripping Utility (GitHub Issue #4).
 *
 * Designed specifically for the Repair Café $0.00/month Firebase Free Tier and
 * UK GDPR Article 5(1)(e) / Safeguarding compliance:
 * - Scales photos down to <= 800px on the longest edge using an offscreen HTML5 <canvas>.
 * - Drawing raw pixel data onto a fresh 2D canvas inherently strips all embedded camera
 *   EXIF metadata, GPS coordinates, device serial numbers, and colour profiles.
 * - Uses a 4-pass WebP (with JPEG fallback) encoding strategy to guarantee each compressed
 *   base64 data URL stays strictly <= 70,000 characters (~52 KB binary / ~68 KB base64).
 * - Separates pure calculation and validation helpers from browser DOM APIs for deterministic
 *   unit testing under Vitest.
 */

import {
  MAX_PHOTOS_PER_REPAIR,
  MAX_PHOTO_DATA_URL_LENGTH,
  RepairPhoto,
} from '../types';

/**
 * Maximum raw input file size accepted from a mobile camera or gallery (20 MB).
 * Prevents out-of-memory browser tab crashes when decoding raw images on older tablets.
 */
export const MAX_RAW_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Default maximum pixel dimension for the longest edge of a compressed item photo.
 */
export const DEFAULT_MAX_DIMENSION_PX = 800;

/**
 * Ordered compression passes evaluated until the encoded dataUrl fits within
 * MAX_PHOTO_DATA_URL_LENGTH (70,000 characters).
 */
export const COMPRESSION_PASSES: ReadonlyArray<{
  maxDimension: number;
  quality: number;
}> = [
  // Pass 1: 800px longest edge at 0.65 quality (~25–42 KB WebP/JPEG)
  { maxDimension: 800, quality: 0.65 },
  // Pass 2: 800px longest edge at 0.45 quality for high-entropy textures
  { maxDimension: 800, quality: 0.45 },
  // Pass 3: 600px longest edge at 0.45 quality if still above 70,000 chars
  { maxDimension: 600, quality: 0.45 },
  // Pass 4: 480px longest edge at 0.38 quality as final fallback
  { maxDimension: 480, quality: 0.38 },
];

/**
 * Result of validating a compressed base64 photo data URL.
 */
export interface PhotoDataUrlValidationResult {
  valid: boolean;
  mimeType?: 'image/webp' | 'image/jpeg';
  sizeBytes: number;
  error?: string;
}

/**
 * Calculates proportional target width and height so that neither dimension exceeds
 * `maxDimension` (default 800px), without upscaling smaller images.
 *
 * @param origWidth Original image width in pixels (must be > 0)
 * @param origHeight Original image height in pixels (must be > 0)
 * @param maxDimension Maximum allowed longest edge in pixels (default 800)
 */
export function calculateScaledDimensions(
  origWidth: number,
  origHeight: number,
  maxDimension: number = DEFAULT_MAX_DIMENSION_PX
): { width: number; height: number } {
  // Reject non-finite, zero, or negative dimensions before computing aspect ratios
  if (
    !Number.isFinite(origWidth) ||
    !Number.isFinite(origHeight) ||
    !Number.isFinite(maxDimension) ||
    origWidth <= 0 ||
    origHeight <= 0 ||
    maxDimension <= 0
  ) {
    throw new Error('Image dimensions and maxDimension must be positive finite numbers.');
  }

  // Do not upscale images that are already within the maximum dimension boundary
  if (origWidth <= maxDimension && origHeight <= maxDimension) {
    return {
      width: Math.max(1, Math.round(origWidth)),
      height: Math.max(1, Math.round(origHeight)),
    };
  }

  // Scale landscape/square images so width equals maxDimension and height is clamped >= 1
  if (origWidth >= origHeight) {
    const scale = maxDimension / origWidth;
    return {
      width: Math.round(maxDimension),
      height: Math.max(1, Math.round(origHeight * scale)),
    };
  }

  // Scale portrait images so height equals maxDimension and width is clamped >= 1
  const scale = maxDimension / origHeight;
  return {
    width: Math.max(1, Math.round(origWidth * scale)),
    height: Math.round(maxDimension),
  };
}

/**
 * Validates that a base64 data URL is a non-empty WebP or JPEG image within the
 * 70,000-character Firestore Free Tier ceiling.
 */
export function validatePhotoDataUrl(
  dataUrl: string,
  maxLength: number = MAX_PHOTO_DATA_URL_LENGTH
): PhotoDataUrlValidationResult {
  // Reject non-string or empty data URL inputs immediately
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
    return {
      valid: false,
      sizeBytes: 0,
      error: 'Photo data URL is empty.',
    };
  }

  // Measure the character length (1 ASCII char = 1 UTF-8 byte in Firestore)
  const sizeBytes = dataUrl.length;
  let mimeType: 'image/webp' | 'image/jpeg' | undefined;
  let prefixLength = 0;

  // Verify the data URL starts with an allowed WebP or JPEG base64 prefix
  if (dataUrl.startsWith('data:image/webp;base64,')) {
    mimeType = 'image/webp';
    prefixLength = 'data:image/webp;base64,'.length;
  } else if (dataUrl.startsWith('data:image/jpeg;base64,')) {
    mimeType = 'image/jpeg';
    prefixLength = 'data:image/jpeg;base64,'.length;
  } else {
    // Reject PNG, SVG, HTML, or non-data URLs
    return {
      valid: false,
      sizeBytes,
      error: 'Unsupported photo encoding. Only WebP and JPEG data URLs are permitted.',
    };
  }

  // Ensure there is actual base64 image payload after the MIME header prefix
  const payloadLength = sizeBytes - prefixLength;
  if (payloadLength < 16) {
    return {
      valid: false,
      mimeType,
      sizeBytes,
      error: 'Photo data URL contains an empty or truncated image payload.',
    };
  }

  // Enforce the 70,000-character (~68 KB) Free Tier storage ceiling
  if (sizeBytes > maxLength) {
    return {
      valid: false,
      mimeType,
      sizeBytes,
      error: `Compressed photo size (${Math.round(sizeBytes / 1024)} KB) exceeds the ${Math.round(
        maxLength / 1024
      )} KB Free Tier limit.`,
    };
  }

  // Data URL passed MIME, payload, and size validation
  return {
    valid: true,
    mimeType,
    sizeBytes,
  };
}

/**
 * Returns true if the volunteer can attach additional photos to the repair record.
 */
export function canAddMorePhotos(
  existingCount: number,
  stagedCount: number,
  maxPhotos: number = MAX_PHOTOS_PER_REPAIR
): boolean {
  // Clamp counts to >= 0 before comparing against the per-item photo limit
  const safeExisting = Math.max(0, existingCount);
  const safeStaged = Math.max(0, stagedCount);
  return safeExisting + safeStaged < maxPhotos;
}

/**
 * Generates a clean, filesystem-safe download filename for an item photo.
 *
 * @param cardNumber Physical card number (#1..#N) if assigned
 * @param referenceToken Registration reference token (e.g. "REF-A38F")
 * @param index 0-based photo index (0 -> "photo-1")
 * @param mimeType Image MIME type ('image/webp' | 'image/jpeg')
 */
export function generatePhotoDownloadFilename(
  cardNumber: number | null | undefined,
  referenceToken: string,
  index: number,
  mimeType: string
): string {
  // Sanitise reference token to alphanumeric and hyphen characters only, falling back to 'repair'
  const safeRef =
    (referenceToken || 'repair')
      .trim()
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'repair';

  // Convert 0-based index to 1-based photo number and select file extension
  const photoNumber = Math.max(1, Math.floor(index) + 1);
  const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';

  // Include physical card number prefix when a valid positive card number is assigned
  if (typeof cardNumber === 'number' && Number.isFinite(cardNumber) && cardNumber > 0) {
    return `card-${Math.floor(cardNumber)}-${safeRef}-photo-${photoNumber}.${ext}`;
  }
  return `${safeRef}-photo-${photoNumber}.${ext}`;
}

/**
 * Formats a character/byte count as a human-readable KB label (e.g. "34 KB").
 */
export function formatPhotoSizeKb(sizeBytes: number): string {
  // Return 0 KB immediately for zero, negative, or non-finite byte values
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return '0 KB';
  }
  // Round positive byte counts to the nearest KB with a minimum display of 1 KB
  const kb = Math.max(1, Math.round(sizeBytes / 1024));
  return `${kb} KB`;
}

/**
 * Decodes a browser File into an HTMLImageElement, revoking the temporary object URL
 * automatically once loaded or on error.
 */
function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    // Create a temporary blob URL to decode the selected image file
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    // Revoke blob URL and resolve once image dimensions and pixels are decoded
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    // Revoke blob URL and surface a clear message if the format is unsupported (e.g. unsupported HEIC)
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      img.src = '';
      reject(
        new Error(
          'Could not decode this image format. Please use a standard JPEG, PNG, or WebP photo.'
        )
      );
    };

    // Trigger asynchronous image decoding
    img.src = objectUrl;
  });
}

/**
 * Encodes an HTMLImageElement onto an offscreen 2D canvas at the given dimensions and quality,
 * attempting WebP first and falling back to JPEG on browsers without WebP canvas encoding.
 * Immediately zeroes the canvas dimensions in `finally` to release iOS Safari / WebKit GPU memory.
 */
function encodeImageOnCanvas(
  img: HTMLImageElement,
  width: number,
  height: number,
  quality: number
): string {
  // Allocate offscreen canvas at the target scaled pixel dimensions
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser 2D canvas context is unavailable for photo compression.');
    }

    // Fill a white background in case the source is a transparent PNG converted to JPEG
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // Drawing raw pixels onto the canvas strips all EXIF, GPS, and camera metadata
    ctx.drawImage(img, 0, 0, width, height);

    // Attempt modern WebP encoding first for superior compression ratio
    const webpUrl = canvas.toDataURL('image/webp', quality);
    if (webpUrl.startsWith('data:image/webp;base64,')) {
      return webpUrl;
    }

    // Fallback to JPEG if the browser does not support WebP canvas serialisation
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    // Release backing WebKit GPU buffer immediately
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Compresses a browser image File via HTML5 <canvas>, strips all EXIF/GPS metadata,
 * and returns a `RepairPhoto` payload (without Firestore `id`) guaranteed to fit within
 * `MAX_PHOTO_DATA_URL_LENGTH` (70,000 characters).
 */
export async function compressRepairPhoto(
  file: File,
  uploadedBy: string
): Promise<Omit<RepairPhoto, 'id'>> {
  // Verify the selected file is a valid image MIME type
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file (JPEG, PNG, or WebP).');
  }

  // Guard against excessively large raw camera files (> 20 MB) before decoding
  if (file.size > MAX_RAW_FILE_BYTES) {
    throw new Error('Selected photo exceeds the 20 MB maximum file size.');
  }

  // Normalise uploader name to satisfy firestore.rules <= 200 char constraint
  const trimmedUploader = (uploadedBy || 'Volunteer Fixer').trim().slice(0, 200) || 'Volunteer Fixer';
  const img = await loadImageElement(file);

  try {
    // Read intrinsic pixel dimensions from the decoded image element
    const origWidth = img.naturalWidth || img.width;
    const origHeight = img.naturalHeight || img.height;
    let lastValidation: PhotoDataUrlValidationResult | null = null;

    // Step through progressive compression passes until the base64 output is <= 70,000 chars
    for (const pass of COMPRESSION_PASSES) {
      const { width, height } = calculateScaledDimensions(
        origWidth,
        origHeight,
        pass.maxDimension
      );

      // Render onto canvas (stripping EXIF) and validate the resulting base64 string
      const dataUrl = encodeImageOnCanvas(img, width, height, pass.quality);
      const validation = validatePhotoDataUrl(dataUrl, MAX_PHOTO_DATA_URL_LENGTH);
      lastValidation = validation;

      // Return immediately on the first pass that meets the Free Tier size budget
      if (validation.valid && validation.mimeType) {
        return {
          dataUrl,
          mimeType: validation.mimeType,
          width,
          height,
          sizeBytes: validation.sizeBytes,
          capturedAt: Date.now(),
          uploadedBy: trimmedUploader,
        };
      }
    }

    // Surface a descriptive error if all 4 compression passes exceeded 70,000 characters
    throw new Error(
      lastValidation?.error ||
        'Photo could not be compressed within the 68 KB storage limit. Please try a simpler framing.'
    );
  } finally {
    // Release decoded image element reference
    img.src = '';
  }
}
