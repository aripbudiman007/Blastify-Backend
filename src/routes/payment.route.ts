import { Router, Request, Response, NextFunction } from 'express';
import {
  handleMidtransNotification,
  handleIpaymuNotification,
} from '../services/payment.service';
import { errorResponse } from '../utils/response';
import { logger } from '../config/logger';

export const paymentRouter = Router();

/**
 * iPaymu notify callback (public — dipanggil server iPaymu, form-urlencoded).
 * Callback tidak bersignature; handler memverifikasi ulang status transaksi
 * langsung ke API check-transaction iPaymu sebelum melunasi invoice.
 * Set notifyUrl otomatis terpasang saat membuat pembayaran:
 *   {APP_URL}/api/v1/payments/ipaymu/notification
 */
paymentRouter.post(
  '/ipaymu/notification',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await handleIpaymuNotification(req.body);
      res.json({ success: true, data: result });
    } catch (err: any) {
      if (['INVALID_PAYLOAD', 'REFERENCE_MISMATCH'].includes(err.code)) {
        errorResponse(res, 400, err.code, err.message);
        return;
      }
      if (err.code === 'INVOICE_NOT_FOUND') {
        errorResponse(res, 404, 'INVOICE_NOT_FOUND', 'Unknown reference_id');
        return;
      }
      logger.error(`iPaymu notification error: ${err.message}`);
      next(err);
    }
  },
);

/**
 * Midtrans payment notification webhook (public — auth via SHA-512 signature).
 * Set this URL in Midtrans Dashboard → Settings → Configuration → Payment Notification URL:
 *   {APP_URL}/api/v1/payments/midtrans/notification
 */
paymentRouter.post(
  '/midtrans/notification',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { config } = await import('../config');
      if (!config.MIDTRANS_SERVER_KEY) {
        errorResponse(res, 503, 'PAYMENT_GATEWAY_DISABLED', 'Midtrans is not configured');
        return;
      }
      const result = await handleMidtransNotification(req.body);
      // Midtrans expects 200 to stop retrying
      res.json({ success: true, data: result });
    } catch (err: any) {
      if (err.code === 'INVALID_SIGNATURE') {
        errorResponse(res, 403, 'INVALID_SIGNATURE', 'Signature verification failed');
        return;
      }
      if (err.code === 'INVOICE_NOT_FOUND') {
        // 404 supaya Midtrans berhenti retry untuk order yang tidak dikenal
        errorResponse(res, 404, 'INVOICE_NOT_FOUND', 'Unknown order_id');
        return;
      }
      logger.error(`Midtrans notification error: ${err.message}`);
      next(err);
    }
  },
);
