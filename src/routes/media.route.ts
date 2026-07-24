import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.middleware';
import { AuthenticatedRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import { isCloudinaryEnabled, uploadToCloudinary } from '../services/media.service';
import { config } from '../config';

export const mediaRouter = Router();
mediaRouter.use(authMiddleware);

const ALLOWED_MIME = [
  // images
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  // video / audio
  'video/mp4', 'video/3gpp', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/wav',
  // documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'application/zip',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`File type "${file.mimetype}" is not allowed`));
  },
});

/**
 * POST /media/upload — multipart form-data, field "file".
 * Returns a Cloudinary URL usable as "url" in POST /messages/send.
 */
mediaRouter.post(
  '/upload',
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!isCloudinaryEnabled()) {
      errorResponse(res, 503, 'MEDIA_UPLOAD_DISABLED', 'Cloudinary is not configured on this server');
      return;
    }
    upload.single('file')(req, res, (err: any) => {
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? `File too large. Maximum ${config.MAX_FILE_SIZE_MB} MB`
          : err.message;
        errorResponse(res, 400, 'UPLOAD_ERROR', message);
        return;
      }
      next();
    });
  },
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        errorResponse(res, 400, 'MISSING_FILE', 'Multipart field "file" is required');
        return;
      }
      const result = await uploadToCloudinary(
        req.file.buffer,
        req.file.originalname,
        req.user!.id,
      );
      successResponse(res, {
        ...result,
        usage: 'Pass "url" as the "url" field in POST /api/v1/messages/send',
      }, 201);
    } catch (err) {
      next(err);
    }
  },
);
