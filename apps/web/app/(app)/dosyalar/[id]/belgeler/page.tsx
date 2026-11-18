import { api } from '@/lib/api';
import type { DocumentRow } from '../types';
import { DocumentsView } from './view';

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const docs = await api<DocumentRow[]>(`/matters/${id}/documents`);
  return <DocumentsView matterId={id} docs={docs} />;
}
