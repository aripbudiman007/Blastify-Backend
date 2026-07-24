import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { list, add, update, remove } from '../controllers/ipwhitelist.controller';

export const ipWhitelistRouter = Router();
ipWhitelistRouter.use(authMiddleware);

const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-fA-F:]+$/;

const addBody = z.object({
  ip: z.string().regex(ipRegex, 'Invalid IP address or CIDR notation'),
  label: z.string().max(100).optional(),
});

const updateBody = z.object({
  ip: z.string().regex(ipRegex).optional(),
  label: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});

const idParam = { params: z.object({ id: z.string().min(1) }) };

ipWhitelistRouter.get('/', list);
ipWhitelistRouter.post('/', validate({ body: addBody }), add);
ipWhitelistRouter.put('/:id', validate({ ...idParam, body: updateBody }), update);
ipWhitelistRouter.delete('/:id', validate(idParam), remove);
