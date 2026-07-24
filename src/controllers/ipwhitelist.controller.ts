import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import {
  listWhitelists, addWhitelist, updateWhitelist, deleteWhitelist,
} from '../services/ipwhitelist.service';

export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await listWhitelists(req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function add(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { ip, label } = req.body;
    const data = await addWhitelist(req.user!.id, ip, label);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await updateWhitelist(req.user!.id, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function remove(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await deleteWhitelist(req.user!.id, req.params.id);
    res.json({ success: true, message: 'IP removed from whitelist' });
  } catch (err) { next(err); }
}
