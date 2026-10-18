/**
 * @file tests/imageCompression.test.ts
 *
 * Unit tests for pure client-side photo compression, validation,
 * capacity limit, and download filename helpers (GitHub Issue #4).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateScaledDimensions,
  validatePhotoDataUrl,
  canAddMorePhotos,
  generatePhotoDownloadFilename,
  formatPhotoSizeKb,
} from '../src/utils/imageCompression';
import {
  MAX_PHOTOS_PER_REPAIR,
  MAX_PHOTO_DATA_URL_LENGTH,
} from '../src/types';

describe('Photo Scaling Helpers (calculateScaledDimensions - Issue #4)', () => {
  it('preserves dimensions when both width and height are within maxDimension', () => {
    // Verify images smaller than maxDimension are not upscaled
    expect(calculateScaledDimensions(640, 480, 800)).toEqual({
      width: 640,
      height: 480,
    });

    // Verify images already at maxDimension remain unchanged
    expect(calculateScaledDimensions(800, 800, 800)).toEqual({
      width: 800,
      height: 800,
    });
  });

  it('scales landscape images down proportionally to fit maxDimension', () => {
    // 4:3 high-resolution smartphone camera image scaled to 800px max edge
    expect(calculateScaledDimensions(4000, 3000, 800)).toEqual({
      width: 800,
      height: 600,
    });

    // 16:9 widescreen image scaled to 800px max edge
    expect(calculateScaledDimensions(1600, 900, 800)).toEqual({
      width: 800,
      height: 450,
    });
  });

  it('scales portrait images down proportionally to fit maxDimension', () => {
    // 3:4 portrait camera photo scaled to 800px max edge
    expect(calculateScaledDimensions(3000, 4000, 800)).toEqual({
      width: 600,
      height: 800,
    });

    // 9:16 portrait photo scaled to 600px fallback step
    expect(calculateScaledDimensions(1080, 1920, 600)).toEqual({
      width: 338,
      height: 600,
    });
  });

  it('clamps extreme aspect ratios to >= 1px and throws on zero or negative dimensions', () => {
    // Extreme panoramic aspect ratio clamps the shorter edge to 1 pixel
    expect(calculateScaledDimensions(10000, 1, 800)).toEqual({
      width: 800,
      height: 1,
    });

    // Zero, negative, or non-finite dimensions throw a descriptive error
    expect(() => calculateScaledDimensions(0, 0, 800)).toThrow(
      'Image dimensions and maxDimension must be positive finite numbers.'
    );
    expect(() => calculateScaledDimensions(-100, 200, 800)).toThrow();
    expect(() => calculateScaledDimensions(400, 300, 0)).toThrow();
  });
});

describe('Photo Data URL Validation (validatePhotoDataUrl - Issue #4)', () => {
  it('accepts valid WebP and JPEG data URLs within the 70,000-character budget', () => {
    // Sample valid base64 WebP and JPEG data URLs
    const validWebp = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
    const validJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

    // Validate WebP result metadata
    const webpResult = validatePhotoDataUrl(validWebp);
    expect(webpResult.valid).toBe(true);
    expect(webpResult.mimeType).toBe('image/webp');
    expect(webpResult.sizeBytes).toBe(validWebp.length);

    // Validate JPEG result metadata
    const jpegResult = validatePhotoDataUrl(validJpeg);
    expect(jpegResult.valid).toBe(true);
    expect(jpegResult.mimeType).toBe('image/jpeg');
    expect(jpegResult.sizeBytes).toBe(validJpeg.length);
  });

  it('rejects non-WebP/JPEG MIME types, malformed prefixes, or empty strings', () => {
    // Empty string is rejected
    expect(validatePhotoDataUrl('').valid).toBe(false);

    // Unsupported MIME types (PNG, HTML) and raw URLs are rejected
    expect(validatePhotoDataUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==').valid).toBe(false);
    expect(validatePhotoDataUrl('data:text/html;base64,PHNjcmlwdD4=').valid).toBe(false);
    expect(validatePhotoDataUrl('https://example.com/photo.webp').valid).toBe(false);

    // Empty base64 payload after valid header is rejected
    expect(validatePhotoDataUrl('data:image/webp;base64,').valid).toBe(false);
  });

  it('rejects data URLs exceeding MAX_PHOTO_DATA_URL_LENGTH (70,000 chars)', () => {
    // Construct a data URL right at the 70,000-character limit and one 1 character over
    const prefix = 'data:image/webp;base64,';
    const exactLimit = prefix + 'A'.repeat(MAX_PHOTO_DATA_URL_LENGTH - prefix.length);
    const overLimit = exactLimit + 'A';

    // Verify boundary behavior at 70,000 characters
    expect(exactLimit.length).toBe(MAX_PHOTO_DATA_URL_LENGTH);
    expect(validatePhotoDataUrl(exactLimit).valid).toBe(true);
    expect(validatePhotoDataUrl(overLimit).valid).toBe(false);
  });
});

describe('Photo Slot Capacity Helper (canAddMorePhotos - Issue #4)', () => {
  it('enforces MAX_PHOTOS_PER_REPAIR = 2 across existing and staged photo counts', () => {
    // Confirm the global per-item photo limit is 2
    expect(MAX_PHOTOS_PER_REPAIR).toBe(2);

    // 0 existing + 0 staged => slots available
    expect(canAddMorePhotos(0, 0)).toBe(true);

    // 1 existing + 0 staged or 0 existing + 1 staged => 1 slot still available
    expect(canAddMorePhotos(1, 0)).toBe(true);
    expect(canAddMorePhotos(0, 1)).toBe(true);

    // 1 existing + 1 staged or 2 existing + 0 staged => full (2/2)
    expect(canAddMorePhotos(1, 1)).toBe(false);
    expect(canAddMorePhotos(2, 0)).toBe(false);
    expect(canAddMorePhotos(0, 2)).toBe(false);
  });

  it('supports custom maxPhotos limits and rejects zero or negative maxPhotos', () => {
    // Custom maxPhotos of 3 allows adding when 2 photos are present
    expect(canAddMorePhotos(1, 1, 3)).toBe(true);
    expect(canAddMorePhotos(2, 1, 3)).toBe(false);

    // Zero or negative maxPhotos always returns false
    expect(canAddMorePhotos(0, 0, 0)).toBe(false);
    expect(canAddMorePhotos(0, 0, -1)).toBe(false);
  });
});

describe('Photo Download Filename & Size Formatting (Issue #4)', () => {
  it('generates deterministic download filenames with card number, reference token, and 1-based index', () => {
    // Card #12 with WebP photo at index 0 -> photo-1.webp
    expect(
      generatePhotoDownloadFilename(12, 'REF-A38F', 0, 'image/webp')
    ).toBe('card-12-REF-A38F-photo-1.webp');

    // Card #7 with JPEG photo at index 1 -> photo-2.jpg
    expect(
      generatePhotoDownloadFilename(7, 'REF-B42C', 1, 'image/jpeg')
    ).toBe('card-7-REF-B42C-photo-2.jpg');
  });

  it('omits card prefix when cardNumber is null or undefined', () => {
    // Unassigned card number falls back to reference token prefix
    expect(
      generatePhotoDownloadFilename(null, 'REF-A38F', 0, 'image/webp')
    ).toBe('REF-A38F-photo-1.webp');

    // Blank reference token falls back to 'repair'
    expect(
      generatePhotoDownloadFilename(null, '   ', 0, 'image/webp')
    ).toBe('repair-photo-1.webp');
  });

  it('formats byte/character counts into human-readable KB strings', () => {
    // 34,816 bytes is exactly 34 KB
    expect(formatPhotoSizeKb(34816)).toBe('34 KB');

    // Small positive values clamp to a minimum of 1 KB
    expect(formatPhotoSizeKb(200)).toBe('1 KB');

    // Zero or negative values return 0 KB
    expect(formatPhotoSizeKb(0)).toBe('0 KB');
    expect(formatPhotoSizeKb(-500)).toBe('0 KB');
  });
});
