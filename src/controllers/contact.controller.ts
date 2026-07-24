import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { successResponse, errorResponse, parsePagination, paginationMeta } from '../utils/response';
import * as svc from '../services/contact.service';
import { prisma } from '../prisma/client';
import { getSession } from '../baileys/session';
import { parsePagination as _parsePagination } from '../utils/response';

const handle404 = (err: any, res: Response, next: NextFunction) => {
  if (err.code === 'CONTACT_NOT_FOUND' || err.code === 'GROUP_NOT_FOUND') {
    errorResponse(res, 404, err.code, err.message); return true;
  }
  return false;
};

// ─── CONTACTS ─────────────────────────────────────────────────────────────────

export async function listContacts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit } = parsePagination(req.query);
    const { q, labelId } = req.query as { q?: string; labelId?: string };
    const result = await svc.listContacts(req.user!.id, q, page, limit, labelId);
    successResponse(res, { contacts: result.contacts }, 200, paginationMeta(page, limit, result.total));
  } catch (err) { next(err); }
}

export async function createContact(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const contact = await svc.createContact(req.user!.id, req.body);
    successResponse(res, { contact }, 201);
  } catch (err: any) {
    if (err.code === 'P2002') { errorResponse(res, 409, 'DUPLICATE_PHONE', 'Phone already exists'); return; }
    next(err);
  }
}

export async function updateContact(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const contact = await svc.updateContact(req.user!.id, req.params.contactId, req.body);
    successResponse(res, { contact });
  } catch (err: any) { if (!handle404(err, res, next)) next(err); }
}

export async function deleteContact(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await svc.deleteContact(req.user!.id, req.params.contactId);
    successResponse(res, { message: 'Contact deleted' });
  } catch (err: any) { if (!handle404(err, res, next)) next(err); }
}

export async function exportContacts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const contacts = await prisma.contact.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'asc' },
      include: {
        labels: { include: { label: { select: { name: true } } } },
        groups: { include: { group: { select: { name: true } } } },
      },
    });

    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [
      'name,phone,labels,groups,notes,variables',
      ...contacts.map((c) =>
        [
          esc(c.name),
          esc(c.phone),
          esc(c.labels.map((l) => l.label.name).join(';')),
          esc(c.groups.map((g) => g.group.name).join(';')),
          esc(c.notes ?? ''),
          esc(c.variables ? JSON.stringify(c.variables) : ''),
        ].join(','),
      ),
    ];

    const filename = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // BOM supaya Excel membaca UTF-8 dengan benar
    res.send('﻿' + rows.join('\r\n'));
  } catch (err) { next(err); }
}

/**
 * Deduplikasi kontak: nomor yang sama dalam format berbeda (08xx vs 628xx vs +62 8xx)
 * digabung — kontak tertua dipertahankan, label/group/variables di-merge, sisanya dihapus.
 * Body: { dryRun?: boolean } — dryRun hanya melaporkan tanpa mengubah data.
 */
export async function dedupeContacts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const dryRun = Boolean(req.body?.dryRun);
    const { formatPhone } = await import('../utils/jid');

    const contacts = await prisma.contact.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'asc' },
      include: { labels: true, groups: true },
    });

    const byNormalized = new Map<string, typeof contacts>();
    for (const c of contacts) {
      const key = formatPhone(c.phone);
      if (!byNormalized.has(key)) byNormalized.set(key, [] as any);
      byNormalized.get(key)!.push(c);
    }

    const groups = [...byNormalized.entries()].filter(([, list]) => list.length > 1);
    const report: any[] = [];

    for (const [normalizedPhone, dupes] of groups) {
      const keeper = dupes[0]; // tertua
      const removed = dupes.slice(1);

      report.push({
        phone: normalizedPhone,
        kept: { id: keeper.id, name: keeper.name, phone: keeper.phone },
        removed: removed.map((r) => ({ id: r.id, name: r.name, phone: r.phone })),
      });

      if (dryRun) continue;

      // Merge variables (keeper menang saat kunci bentrok) + pindahkan label/group
      const mergedVariables = Object.assign(
        {},
        ...removed.map((r) => (r.variables as object) ?? {}),
        (keeper.variables as object) ?? {},
      );
      const labelIds = new Set(keeper.labels.map((l) => l.labelId));
      const groupIds = new Set(keeper.groups.map((g) => g.groupId));

      const ops: any[] = [
        prisma.contact.update({
          where: { id: keeper.id },
          data: {
            phone: normalizedPhone,
            variables: Object.keys(mergedVariables).length ? mergedVariables : undefined,
          },
        }),
      ];
      for (const r of removed) {
        for (const l of r.labels) {
          if (!labelIds.has(l.labelId)) {
            labelIds.add(l.labelId);
            ops.push(prisma.contactLabelMember.create({ data: { contactId: keeper.id, labelId: l.labelId } }));
          }
        }
        for (const g of r.groups) {
          if (!groupIds.has(g.groupId)) {
            groupIds.add(g.groupId);
            ops.push(prisma.contactGroupMember.create({ data: { contactId: keeper.id, groupId: g.groupId } }));
          }
        }
        ops.push(prisma.contact.delete({ where: { id: r.id } }));
      }
      await prisma.$transaction(ops);
    }

    successResponse(res, {
      dryRun,
      duplicateGroups: groups.length,
      contactsRemoved: report.reduce((n, g) => n + g.removed.length, 0),
      details: report,
    });
  } catch (err) { next(err); }
}

/** Zero-dependency CSV parser — handles quoted fields and CRLF/LF line endings */
function parseCsv(raw: string): Array<Record<string, string>> {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  const splitLine = (line: string): string[] => {
    const cols: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        cols.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  };

  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = splitLine(line);
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (vals[i] ?? '').trim()]));
  });
}

export async function importContacts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) { errorResponse(res, 400, 'NO_FILE', 'CSV file is required'); return; }

    const rawRows = parseCsv(file.buffer.toString('utf8'));
    if (rawRows.length === 0) { errorResponse(res, 400, 'EMPTY_FILE', 'CSV file is empty or missing header row'); return; }

    // Filter rows that have at least name + phone columns
    const rows = rawRows.filter((r) => r['name'] && r['phone']) as Array<{ [key: string]: string; name: string; phone: string }>;
    if (rows.length === 0) { errorResponse(res, 400, 'MISSING_COLUMNS', 'CSV must have "name" and "phone" columns'); return; }

    const result = await svc.importContacts(req.user!.id, rows);
    successResponse(res, result, 200);
  } catch (err: any) {
    errorResponse(res, 400, 'IMPORT_FAILED', err.message);
  }
}

// ─── GROUPS ───────────────────────────────────────────────────────────────────

export async function listGroups(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const groups = await svc.listGroups(req.user!.id);
    successResponse(res, { groups });
  } catch (err) { next(err); }
}

export async function createGroup(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const group = await svc.createGroup(req.user!.id, req.body.name, req.body.description);
    successResponse(res, { group }, 201);
  } catch (err) { next(err); }
}

export async function updateGroup(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const group = await svc.updateGroup(req.user!.id, req.params.groupId, req.body);
    successResponse(res, { group });
  } catch (err: any) { if (!handle404(err, res, next)) next(err); }
}

export async function deleteGroup(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await svc.deleteGroup(req.user!.id, req.params.groupId);
    successResponse(res, { message: 'Group deleted' });
  } catch (err: any) { if (!handle404(err, res, next)) next(err); }
}

export async function addMembers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const group = await svc.addContactsToGroup(req.user!.id, req.params.groupId, req.body.contactIds);
    successResponse(res, { group });
  } catch (err: any) { if (!handle404(err, res, next)) next(err); }
}

export async function removeMember(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await svc.removeContactFromGroup(req.user!.id, req.params.groupId, req.params.contactId);
    successResponse(res, { message: 'Member removed' });
  } catch (err: any) { if (!handle404(err, res, next)) next(err); }
}

export async function getGroupContacts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit } = parsePagination(req.query);
    const result = await svc.getGroupContacts(req.user!.id, req.params.groupId, page, limit);
    successResponse(res, { contacts: result.contacts }, 200, paginationMeta(page, limit, result.total));
  } catch (err: any) { if (!handle404(err, res, next)) next(err); }
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export async function listLabels(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const labels = await svc.listLabels(req.user!.id);
    successResponse(res, { labels });
  } catch (err) { next(err); }
}

export async function createLabel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const label = await svc.createLabel(req.user!.id, req.body);
    successResponse(res, { label }, 201);
  } catch (err: any) {
    if (err.code === 'P2002') { errorResponse(res, 409, 'LABEL_EXISTS', 'Label name already exists'); return; }
    next(err);
  }
}

export async function updateLabel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const label = await svc.updateLabel(req.user!.id, req.params.labelId as string, req.body);
    successResponse(res, { label });
  } catch (err: any) {
    if (err.code === 'LABEL_NOT_FOUND') { errorResponse(res, 404, 'LABEL_NOT_FOUND', err.message); return; }
    next(err);
  }
}

export async function deleteLabel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await svc.deleteLabel(req.user!.id, req.params.labelId as string);
    successResponse(res, { message: 'Label deleted' });
  } catch (err: any) {
    if (err.code === 'LABEL_NOT_FOUND') { errorResponse(res, 404, 'LABEL_NOT_FOUND', err.message); return; }
    next(err);
  }
}

export async function assignLabels(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const contact = await svc.assignLabels(req.user!.id, req.params.contactId as string, req.body.labelIds);
    successResponse(res, { contact });
  } catch (err: any) {
    if (!handle404(err, res, next)) next(err);
  }
}

export async function removeLabelFromContact(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await svc.removeLabelFromContact(req.user!.id, req.params.contactId as string, req.params.labelId as string);
    successResponse(res, { message: 'Label removed from contact' });
  } catch (err: any) {
    if (!handle404(err, res, next)) next(err);
  }
}

// ─── Validate WhatsApp Numbers ────────────────────────────────────────────────

export async function validateNumbers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { deviceId, phones } = req.query as { deviceId?: string; phones?: string };

    if (!deviceId) {
      errorResponse(res, 400, 'MISSING_DEVICE_ID', 'Query param "deviceId" is required');
      return;
    }
    if (!phones) {
      errorResponse(res, 400, 'MISSING_PHONES', 'Query param "phones" is required (comma-separated)');
      return;
    }

    // Verify device belongs to user and is connected
    const device = await prisma.device.findFirst({ where: { id: deviceId, userId: req.user!.id } });
    if (!device) {
      errorResponse(res, 404, 'DEVICE_NOT_FOUND', 'Device not found');
      return;
    }
    if (device.status !== 'CONNECTED') {
      errorResponse(res, 400, 'DEVICE_NOT_CONNECTED', 'Device is not connected to WhatsApp');
      return;
    }

    const sock = getSession(deviceId);
    if (!sock) {
      errorResponse(res, 503, 'SESSION_NOT_ACTIVE', 'WhatsApp session is not active');
      return;
    }

    const phoneList = phones.split(',').map((p) => p.trim()).filter(Boolean);
    if (phoneList.length === 0) {
      errorResponse(res, 400, 'MISSING_PHONES', 'At least one phone number is required');
      return;
    }
    if (phoneList.length > 50) {
      errorResponse(res, 400, 'TOO_MANY_PHONES', 'Maximum 50 phone numbers per request');
      return;
    }

    const results = await sock.onWhatsApp(...phoneList);

    const formatted = phoneList.map((phone) => {
      const match = (results ?? []).find((r: any) => r.jid?.startsWith(phone.replace(/\D/g, '')));
      return {
        phone,
        isWhatsApp: match?.exists ?? false,
        jid: match?.jid ?? null,
      };
    });

    successResponse(res, { results: formatted });
  } catch (err) {
    next(err);
  }
}
