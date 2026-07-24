import { Router } from 'express';
import { activeAnnouncements } from '../controllers/admin/admin-announcement.controller';

export const announcementRouter = Router();

// Public — no auth needed, cached by CDN/client for 60s
announcementRouter.get('/active', activeAnnouncements);
