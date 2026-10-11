import {importDocument} from '../core/document-core.js';

/** A recovery is a new identity, never an overwrite or merge of the source. */
export function createRecoveryDocument(document, {
  persistedRevision = null,
  reason = 'SAVE_FAILED',
  id = crypto.randomUUID(),
  now = new Date().toISOString()
} = {}) {
  const recovered = importDocument(document);
  if (!id || id === recovered.id) throw new Error('恢复项目必须使用新的项目 ID');
  const source = {
    projectId: recovered.id,
    title: recovered.title,
    revision: recovered.revision,
    persistedRevision,
    createdAt: recovered.metadata.createdAt,
    updatedAt: recovered.metadata.updatedAt
  };
  const recovery = {type: 'independent-project', source, recoveredAt: now, reason};
  // Preserve any previous/custom recovery metadata, including repeated recovery history.
  if (Object.hasOwn(recovered.metadata, 'spRecovery')) recovery.previous = recovered.metadata.spRecovery;
  recovered.id = id;
  recovered.title += ' · 恢复副本';
  recovered.revision = 0;
  recovered.metadata = {...recovered.metadata, createdAt: now, updatedAt: now, spRecovery: recovery};
  return importDocument(recovered);
}
