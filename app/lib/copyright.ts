import piexif from 'piexifjs';

/**
 * Embeds the photographer's name into a JPEG's EXIF Copyright/Artist
 * fields, preserving every other byte (no decode/re-encode -- piexifjs
 * only patches the EXIF segment, so there's no quality loss). Returns the
 * original buffer unchanged for non-JPEG sources (HEIC, PNG, video) or if
 * the EXIF segment can't be parsed.
 */
export function embedCopyright(buffer: Buffer, photographer: string): Buffer {
  if (!photographer.trim()) return buffer;

  try {
    const binary = buffer.toString('binary');
    const exifObj = piexif.load(binary);
    exifObj['0th'] = exifObj['0th'] || {};
    exifObj['0th'][piexif.ImageIFD.Artist] = photographer;
    exifObj['0th'][piexif.ImageIFD.Copyright] = `© ${photographer}`;
    const exifBytes = piexif.dump(exifObj);
    const withExif = piexif.insert(exifBytes, binary);
    return Buffer.from(withExif, 'binary');
  } catch {
    return buffer;
  }
}
