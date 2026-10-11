export const defaultStorageQuota={maxProjects:100,maxBytes:1024*1024*1024,warningPercent:80};
export type StorageQuota=typeof defaultStorageQuota;
export function validStorageQuota(value:unknown):value is StorageQuota {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const q=value as StorageQuota;return Object.keys(q).sort().join(',')==='maxBytes,maxProjects,warningPercent'&&Number.isSafeInteger(q.maxProjects)&&q.maxProjects>0&&q.maxProjects<=100000&&Number.isSafeInteger(q.maxBytes)&&q.maxBytes>0&&q.maxBytes<=10*1024**4&&Number.isInteger(q.warningPercent)&&q.warningPercent>=1&&q.warningPercent<=100;
}
