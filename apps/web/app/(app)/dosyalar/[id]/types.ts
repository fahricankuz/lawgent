import type { matterStatusLabel, matterTypeLabel } from '@lawgent/shared';

export interface MatterDetail {
  matter: {
    id: string; type: keyof typeof matterTypeLabel; title: string; status: keyof typeof matterStatusLabel;
    court: string | null; esasNo: string | null; description: string | null; openedAt: string;
    aiEnabled: boolean; isWalled: boolean; clientId: string; clientName: string; isLead: boolean; aiAvailable: boolean;
  };
  team: { id: string; fullName: string; role: 'lead' | 'member' }[];
  parties: { id: string; name: string; role: string }[];
  me: string;
}

export interface DocumentRow {
  id: string; title: string; category: string | null; versionId: string; versionNo: number; fileName: string;
  mimeType: string; sizeBytes: number; ocrStatus: 'pending' | 'processing' | 'done' | 'failed'; pageCount: number | null;
  isEvidence: boolean; uploadedBy: string; updatedAt: string;
}
