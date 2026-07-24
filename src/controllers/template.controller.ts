import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import {
  listTemplates, getTemplate, createTemplate,
  updateTemplate, deleteTemplate, useTemplate,
} from '../services/template.service';

export async function list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { category, search, page, limit } = req.query as any;
    const data = await listTemplates(userId, {
      category, search,
      page: page ? Number(page) : 1,
      limit: Math.min(Number(limit ?? 20), 100),
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function detail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await getTemplate(req.user!.id, req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await createTemplate(req.user!.id, req.user!.plan, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await updateTemplate(req.user!.id, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function remove(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await deleteTemplate(req.user!.id, req.params.id);
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) { next(err); }
}

export async function use(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const vars = req.body?.vars ?? {};
    const data = await useTemplate(req.user!.id, req.params.id, vars);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
