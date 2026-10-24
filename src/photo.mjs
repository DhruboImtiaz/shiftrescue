export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

// Validate before sending inline image data to Google. Never fetch a supplied URL.
export function validatePhoto(image) {
  const fail = message => { throw new Error(message); };
  if (!image || typeof image !== 'object' || Array.isArray(image)) fail('Choose a photo of your event or roster.');
  const { mimeType, data } = image;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) fail('Use a JPG, PNG or WebP photo. Export HEIC photos as JPG first.');
  if (typeof data !== 'string' || !data.length || data.length % 4 || data.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) fail('The photo is invalid or larger than 2 MB. Choose a smaller photo.');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES || bytes.toString('base64') !== data) fail('The photo is invalid or larger than 2 MB.');
  const matches = mimeType === 'image/jpeg' ? bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mimeType === 'image/png' ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR'
      : bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!matches) fail('The file does not match its image format. Choose a valid JPG, PNG or WebP photo.');
  return { mimeType, data };
}
