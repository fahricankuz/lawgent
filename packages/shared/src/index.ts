/** API sözleşmesi: web ve api aynı şemaları kullanır. */
import { z } from 'zod';

export const uuid = z.uuid();

export const MATTER_TYPES = ['dava', 'icra', 'danismanlik', 'sozlesme'] as const;
export const MATTER_STATUSES = ['acik', 'beklemede', 'kapali'] as const;
export const TENANT_ROLES = ['owner', 'partner', 'lawyer', 'staff'] as const;

export const matterTypeLabel: Record<(typeof MATTER_TYPES)[number], string> = {
  dava: 'Dava',
  icra: 'İcra',
  danismanlik: 'Danışmanlık',
  sozlesme: 'Sözleşme',
};
export const matterStatusLabel: Record<(typeof MATTER_STATUSES)[number], string> = {
  acik: 'Açık',
  beklemede: 'Beklemede',
  kapali: 'Kapalı',
};
export const tenantRoleLabel: Record<(typeof TENANT_ROLES)[number], string> = {
  owner: 'Büro sahibi',
  partner: 'Ortak',
  lawyer: 'Avukat',
  staff: 'Destek personeli',
};

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

// --- Kimlik doğrulama ---
export const loginInput = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(256),
  totp: z.string().regex(/^\d{6}$/).optional(),
  tenantId: uuid.optional(),
});
export type LoginInput = z.infer<typeof loginInput>;

// --- Müvekkil ---
export const createClientInput = z
  .object({
    kind: z.enum(['person', 'company']),
    displayName: z.string().trim().min(2).max(200),
    tckn: z
      .string()
      .trim()
      .regex(/^\d{11}$/, 'TCKN 11 haneli olmalı')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    vkn: z
      .string()
      .trim()
      .regex(/^\d{10}$/, 'VKN 10 haneli olmalı')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    taxOffice: optionalText(120),
    email: z.email().optional().or(z.literal('').transform(() => undefined)),
    phone: optionalText(40),
    address: optionalText(500),
    kvkkConsent: z.boolean().default(false),
    isRestricted: z.boolean().default(false),
    notes: optionalText(2000),
  })
  .refine((v) => v.kind === 'person' || !v.tckn, { message: 'TCKN yalnızca gerçek kişiler için', path: ['tckn'] });
export type CreateClientInput = z.infer<typeof createClientInput>;

// --- Dosya ---
export const createMatterInput = z.object({
  clientId: uuid,
  type: z.enum(MATTER_TYPES),
  title: z.string().trim().min(2).max(200),
  court: optionalText(200),
  esasNo: optionalText(60),
  description: optionalText(4000),
  memberIds: z.array(uuid).max(50).default([]),
  counterparties: z.array(z.string().trim().min(2).max(200)).max(20).default([]),
});
export type CreateMatterInput = z.infer<typeof createMatterInput>;

export const addMemberInput = z.object({ userId: uuid, role: z.enum(['lead', 'member']).default('member') });

export const createDeadlineInput = z.object({
  title: z.string().trim().min(2).max(200),
  dueAt: z.iso.datetime({ offset: true }),
  isCritical: z.boolean().default(false),
});
export const createHearingInput = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  court: optionalText(200),
  room: optionalText(60),
  note: optionalText(1000),
});

// --- Sohbet ---
export const createThreadInput = z.object({
  title: z.string().trim().min(1).max(200).default('Yeni sohbet'),
  documentIds: z.array(uuid).max(50).default([]),
});
export const askInput = z.object({
  question: z.string().trim().min(2).max(4000),
  documentIds: z.array(uuid).max(50).optional(),
});

export interface Citation {
  n: number;
  documentId: string;
  documentTitle: string;
  versionId: string;
  pageFrom: number;
  pageTo: number;
  articleRef: string | null;
  excerpt: string;
}

/** "[1] Kira sözleşmesi.pdf · s.4, m.7.2" */
export function citationLabel(c: Citation): string {
  const page = c.pageFrom === c.pageTo ? `s.${c.pageFrom}` : `s.${c.pageFrom}–${c.pageTo}`;
  return `[${c.n}] ${c.documentTitle} · ${page}${c.articleRef ? `, ${c.articleRef}` : ''}`;
}
