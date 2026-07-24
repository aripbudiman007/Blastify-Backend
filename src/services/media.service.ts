import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config';

let configured = false;

export function isCloudinaryEnabled(): boolean {
  return Boolean(
    config.CLOUDINARY_CLOUD_NAME && config.CLOUDINARY_API_KEY && config.CLOUDINARY_API_SECRET,
  );
}

function ensureConfigured(): void {
  if (!configured) {
    cloudinary.config({
      cloud_name: config.CLOUDINARY_CLOUD_NAME,
      api_key: config.CLOUDINARY_API_KEY,
      api_secret: config.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
}

export interface UploadedMedia {
  url: string;
  publicId: string;
  format: string | undefined;
  resourceType: string;
  bytes: number;
  originalFilename: string;
}

/**
 * Upload a file buffer to Cloudinary. resource_type "auto" handles
 * images, video/audio, and raw documents (pdf, docx, ...).
 */
export function uploadToCloudinary(
  buffer: Buffer,
  originalFilename: string,
  userId: string,
): Promise<UploadedMedia> {
  ensureConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `blastify/${userId}`,
        resource_type: 'auto',
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error || !result) {
          return reject(error ?? new Error('Cloudinary upload returned no result'));
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          resourceType: result.resource_type,
          bytes: result.bytes,
          originalFilename,
        });
      },
    );
    stream.end(buffer);
  });
}
