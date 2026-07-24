import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import {
  listEmailTemplates, getEmailTemplate, createEmailTemplate,
  updateEmailTemplate, deleteEmailTemplate, sendTestEmailTemplate,
} from '../services/email-template.service';

export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await listEmailTemplates(req.user!.id);
    res.json({ success: true, data: { templates: data } });
  } catch (err) { next(err); }
}

export async function detail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await getEmailTemplate(req.user!.id, req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await createEmailTemplate(req.user!.id, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await updateEmailTemplate(req.user!.id, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function remove(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await deleteEmailTemplate(req.user!.id, req.params.id);
    res.json({ success: true, message: 'Template berhasil dihapus' });
  } catch (err) { next(err); }
}

export async function test(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await sendTestEmailTemplate(req.user!.id, req.params.id, req.body.recipientEmail, req.body.variables ?? {});
    res.json({ success: true, message: `Email test dikirim ke ${req.body.recipientEmail}` });
  } catch (err) { next(err); }
}
