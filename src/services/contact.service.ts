import { prisma } from '../prisma/client';
import { formatPhone } from '../utils/jid';

function throwNotFound(msg: string, code = 'CONTACT_NOT_FOUND'): never {
  const err = new Error(msg) as any;
  err.status = 404; err.code = code; throw err;
}

// ─── CONTACTS ─────────────────────────────────────────────────────────────────

export async function listContacts(
  userId: string,
  q?: string,
  page = 1,
  limit = 20,
  labelId?: string,
) {
  const where: any = { userId };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
    ];
  }
  if (labelId) {
    where.labels = { some: { labelId } };
  }
  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { name: 'asc' },
      include: { labels: { include: { label: { select: { id: true, name: true, color: true } } } } },
    }),
    prisma.contact.count({ where }),
  ]);
  return { contacts: contacts.map(flattenContact), total };
}

function flattenContact(c: any) {
  return {
    ...c,
    labels: (c.labels ?? []).map((l: any) => l.label),
  };
}

export async function createContact(
  userId: string,
  data: { name: string; phone: string; variables?: Record<string, string>; notes?: string },
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
  if (user) {
    const { checkContactLimit } = await import('../middleware/plan.middleware');
    await checkContactLimit(userId, user.plan);
  }

  const phone = formatPhone(data.phone);
  return prisma.contact.create({
    data: { userId, name: data.name, phone, variables: data.variables, notes: data.notes },
  });
}

export async function updateContact(
  userId: string,
  contactId: string,
  data: { name?: string; variables?: Record<string, string>; notes?: string },
) {
  const existing = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!existing) throwNotFound('Contact not found');
  return prisma.contact.update({ where: { id: contactId }, data });
}

export async function deleteContact(userId: string, contactId: string) {
  const existing = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!existing) throwNotFound('Contact not found');
  await prisma.contact.delete({ where: { id: contactId } });
}

/** CSV import — returns { created, updated, failed } counts */
export async function importContacts(
  userId: string,
  rows: Array<{ name: string; phone: string; [key: string]: string }>,
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
  if (user) {
    const { checkContactLimit } = await import('../middleware/plan.middleware');
    await checkContactLimit(userId, user.plan);
  }

  let created = 0, updated = 0, failed = 0;

  for (const row of rows) {
    try {
      if (!row.phone || !row.name) { failed++; continue; }
      const phone = formatPhone(row.phone);
      // Extract custom variables (any column that's not name/phone/notes)
      const { name, phone: _p, notes, ...rest } = row;
      const variables = Object.keys(rest).length > 0 ? rest : undefined;

      const existing = await prisma.contact.findUnique({
        where: { userId_phone: { userId, phone } },
        select: { id: true },
      });

      await prisma.contact.upsert({
        where: { userId_phone: { userId, phone } },
        create: { userId, name, phone, notes, variables },
        update: { name, notes, variables },
      });

      if (existing) updated++;
      else created++;
    } catch {
      failed++;
    }
  }
  return { created, updated, failed };
}

// ─── GROUPS ───────────────────────────────────────────────────────────────────

export async function listGroups(userId: string) {
  return prisma.contactGroup.findMany({
    where: { userId },
    include: { _count: { select: { members: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function createGroup(userId: string, name: string, description?: string) {
  return prisma.contactGroup.create({ data: { userId, name, description } });
}

export async function updateGroup(userId: string, groupId: string, data: { name?: string; description?: string }) {
  const existing = await prisma.contactGroup.findFirst({ where: { id: groupId, userId } });
  if (!existing) throwNotFound('Group not found', 'GROUP_NOT_FOUND');
  return prisma.contactGroup.update({ where: { id: groupId }, data });
}

export async function deleteGroup(userId: string, groupId: string) {
  const existing = await prisma.contactGroup.findFirst({ where: { id: groupId, userId } });
  if (!existing) throwNotFound('Group not found', 'GROUP_NOT_FOUND');
  await prisma.contactGroup.delete({ where: { id: groupId } });
}

export async function addContactsToGroup(userId: string, groupId: string, contactIds: string[]) {
  const group = await prisma.contactGroup.findFirst({ where: { id: groupId, userId } });
  if (!group) throwNotFound('Group not found', 'GROUP_NOT_FOUND');

  const validContacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, userId },
    select: { id: true },
  });

  await prisma.contactGroupMember.createMany({
    data: validContacts.map((c) => ({ contactId: c.id, groupId })),
    skipDuplicates: true,
  });

  return prisma.contactGroup.findUnique({
    where: { id: groupId },
    include: { _count: { select: { members: true } } },
  });
}

export async function removeContactFromGroup(userId: string, groupId: string, contactId: string) {
  const group = await prisma.contactGroup.findFirst({ where: { id: groupId, userId } });
  if (!group) throwNotFound('Group not found', 'GROUP_NOT_FOUND');
  await prisma.contactGroupMember.deleteMany({ where: { contactId, groupId } });
}

export async function getGroupContacts(userId: string, groupId: string, page = 1, limit = 50) {
  const group = await prisma.contactGroup.findFirst({ where: { id: groupId, userId } });
  if (!group) throwNotFound('Group not found', 'GROUP_NOT_FOUND');

  const [members, total] = await Promise.all([
    prisma.contactGroupMember.findMany({
      where: { groupId },
      include: { contact: { include: { labels: { include: { label: { select: { id: true, name: true, color: true } } } } } } },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.contactGroupMember.count({ where: { groupId } }),
  ]);
  return { contacts: members.map((m) => flattenContact(m.contact)), total };
}

// ─── CONTACT LABELS ───────────────────────────────────────────────────────────

export async function listLabels(userId: string) {
  return prisma.contactLabel.findMany({
    where: { userId },
    include: { _count: { select: { contacts: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function createLabel(userId: string, data: { name: string; color?: string }) {
  return prisma.contactLabel.create({ data: { userId, name: data.name, color: data.color } });
}

export async function updateLabel(
  userId: string,
  labelId: string,
  data: { name?: string; color?: string },
) {
  const existing = await prisma.contactLabel.findFirst({ where: { id: labelId, userId } });
  if (!existing) throwNotFound('Label not found', 'LABEL_NOT_FOUND');
  return prisma.contactLabel.update({ where: { id: labelId }, data });
}

export async function deleteLabel(userId: string, labelId: string) {
  const existing = await prisma.contactLabel.findFirst({ where: { id: labelId, userId } });
  if (!existing) throwNotFound('Label not found', 'LABEL_NOT_FOUND');
  await prisma.contactLabel.delete({ where: { id: labelId } });
}

export async function assignLabels(userId: string, contactId: string, labelIds: string[]) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!contact) throwNotFound('Contact not found');

  const validLabels = await prisma.contactLabel.findMany({
    where: { id: { in: labelIds }, userId },
    select: { id: true },
  });

  await prisma.contactLabelMember.createMany({
    data: validLabels.map((l) => ({ contactId, labelId: l.id })),
    skipDuplicates: true,
  });

  return prisma.contact.findUnique({
    where: { id: contactId },
    include: { labels: { include: { label: { select: { id: true, name: true, color: true } } } } },
  }).then((c) => c ? flattenContact(c) : null);
}

export async function removeLabelFromContact(
  userId: string,
  contactId: string,
  labelId: string,
) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, userId } });
  if (!contact) throwNotFound('Contact not found');
  await prisma.contactLabelMember.deleteMany({ where: { contactId, labelId } });
}
