import { Router } from 'express';
import { authRouter } from './auth.route';
import { deviceRouter } from './device.route';
import { messageRouter } from './message.route';
import { webhookRouter } from './webhook.route';
import { accountRouter } from './account.route';
import { contactRouter } from './contact.route';
import { autoreplyRouter } from './autoreply.route';
import { chatflowRouter } from './chatflow.route';
import { broadcastRouter } from './broadcast.route';
import { compatRouter } from './compat.route';
import { integrationRouter } from './integration.route';
import { inboxRouter } from './inbox.route';
import { templateRouter } from './template.route';
import { ipWhitelistRouter } from './ipwhitelist.route';
import { adminRouter } from './admin/index';
import { announcementRouter } from './announcement.route';
import { paymentRouter } from './payment.route';
import { mediaRouter } from './media.route';
import { planRouter } from './plan.route';
import { emailTemplateRouter } from './email-template.route';

export const rootRouter = Router();

rootRouter.use('/auth', authRouter);
rootRouter.use('/account', accountRouter);
rootRouter.use('/devices', deviceRouter);
rootRouter.use('/messages', messageRouter);
rootRouter.use('/webhooks', webhookRouter);
rootRouter.use('/contacts', contactRouter);
rootRouter.use('/auto-replies', autoreplyRouter);
rootRouter.use('/chat-flows', chatflowRouter);
rootRouter.use('/broadcasts', broadcastRouter);
rootRouter.use('/integrations', integrationRouter);
rootRouter.use('/inbox', inboxRouter);
rootRouter.use('/templates', templateRouter);
rootRouter.use('/ip-whitelist', ipWhitelistRouter);
rootRouter.use('/announcements', announcementRouter);
rootRouter.use('/payments', paymentRouter);
rootRouter.use('/media', mediaRouter);
rootRouter.use('/plans', planRouter);
rootRouter.use('/account/email-templates', emailTemplateRouter);

// Admin backoffice — /api/v1/admin/...
rootRouter.use('/admin', adminRouter);

// Blastify-compatible API — /api/v1/blastify/...
rootRouter.use('/blastify', compatRouter);
