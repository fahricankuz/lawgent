import type { Citation } from '@lawgent/shared';
import { api } from '@/lib/api';
import type { DocumentRow, MatterDetail } from '../types';
import { ChatView, type Message } from './chat';

interface ThreadRow { id: string; title: string; createdAt: string; createdBy: string; messages: number }
interface ThreadDetail { thread: { id: string }; documentIds: string[]; messages: (Message & { citations: Citation[] })[] }

export default async function ChatPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const { t } = await searchParams;
  const [{ matter }, docs, threads] = await Promise.all([
    api<MatterDetail>(`/matters/${id}`),
    api<DocumentRow[]>(`/matters/${id}/documents`),
    api<ThreadRow[]>(`/matters/${id}/threads`),
  ]);
  const threadId = t === 'yeni' ? undefined : (t ?? threads[0]?.id);
  const detail = threadId ? await api<ThreadDetail>(`/threads/${threadId}`) : null;

  if (!matter.aiAvailable) {
    return (
      <div className="lg-alert lg-alert--neutral" style={{ marginTop: 12 }}>
        {matter.isWalled
          ? 'Bu dosyada etik duvar var; dosyayla sohbet kapalı.'
          : 'Bu dosyada sohbet kapalı. Ekip lideri Genel bakış sekmesinden açabilir.'}
      </div>
    );
  }

  return (
    <ChatView
      key={threadId ?? 'yeni'}
      matterId={id}
      docs={docs}
      threads={threads}
      threadId={threadId}
      initialSelected={detail?.documentIds.length ? detail.documentIds : docs.filter((d) => d.ocrStatus === 'done').map((d) => d.id)}
      initialMessages={detail?.messages ?? []}
    />
  );
}
