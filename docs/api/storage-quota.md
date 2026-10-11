# SP-082 Storage quota and usage

The default global `storageQuota` setting is `{maxProjects:100,maxBytes:1073741824,warningPercent:80}`: 100 active cloud projects, 1 GiB retained document values, warning at 80%. These are initial product limits, not measured safe Hakari disk capacity. Existing `system_settings` stores this object; no quota migration or per-user override table is added. Invalid stored quota objects fall back to the validated defaults.

`GET /api/v1/me/storage` requires the current user's active Web Session and returns their usage only. `GET /api/v1/admin/storage?q=&limit=&offset=` requires a live admin Web Session and returns paged user usage metadata. It includes `userId`, username (admin listing only), usage breakdown, limits, warning and over-quota flags; no document/title/password/session/token values. Both are mounted through `registerQuotaRoutes(app,{db,actor})`.

`usage` contains:

- `activeProjects` and `trashedProjects`.
- `projectBytes`: all retained project JSONB, including the recycle bin.
- `historyBytes`: immutable project revision JSONB.
- `themeMetadataBytes` and `themeVersionBytes`: retained theme source metadata and all private published snapshots, including archived/deleted themes.
- `receiptBytes`: full saved mutation/import/theme idempotency results. Project/theme ownership determines accounting, including after project ownership transfer.
- `shareBytes`: retained fixed-revision share HTML if the share table is installed, including expired or revoked shares; share ownership determines accounting.
- `totalBytes`: the sum of these categories.

JSONB values are measured using PostgreSQL `pg_column_size` on persisted columns, reflecting column compression. Share HTML is measured by UTF-8 `octet_length`. Embedded image/data payloads are included in these values; this does not allocate unowned external filesystem assets to individual users. Indexes, row overhead, WAL, audit/metrics, backups and database free space are excluded. Thus the response explicitly says `physicalDiskLimit:false`; it is not a physical disk hard limit or a promise of disk bytes freed. [PostgreSQL size functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-DBOBJECT)

User writes acquire a per-owner transaction advisory lock before resource row locks, so simultaneous writes to different projects/themes cannot each consume the same spare quota. The usage is read before the change and checked after all document/history/receipt writes, within the same transaction. Rejection rolls back those writes and emits `QUOTA_EXCEEDED` (409) with usage/limits and recovery guidance. Existing CAS, lease, session/token/scope and ownership checks remain mandatory. Idempotent receipt replay returns the previous result without new storage use, even if limits have since been lowered.

Quota limits reject project creation/import, new theme imports/versions, content growth, quota-increasing restore, and incoming ownership transfers that exceed the receiver's limits. Existing over-quota records are never erased. Reads/exports remain allowed under their existing permissions. Recycle-bin moves, theme archival without name growth, and shrinking current project content/theme metadata remain available; the necessary new immutable history/receipt overhead is an explicit exception. Shrink checks omit project revision and the changing update timestamp, while preserving all business content and unknown fields.

**Moving content to the recycle bin does not free retained historical document bytes.** Shrinking a current document may still increase total retained bytes because the old immutable history and new idempotency result are preserved. Recovery exceptions are intentional growth governance, not a claim that total physical storage cannot grow. No automatic history cleanup or irreversible deletion is introduced.

Integration points cover project create/import/shared mutations (edit, snapshot, rename, theme application, history restore, trash/restore), admin trash/restore/ownership transfer, and theme import/publish/shared mutations. Incoming transfers lock both affected account quota keys in sorted order and attribute existing history/receipts to the receiving owner before checking the result. Share creation must use `quotaBefore` before resource locks and `enforceStorageQuota` after inserting its retained HTML.

Verification uses disposable PostgreSQL: concurrent project creation at count limit, rejected import with no receipt, content growth rollback, smaller content and trash allowed beyond byte limit, preserved history, idempotent project/theme replay with unchanged usage, theme version/import rejection and metadata shrink/archive/delete, transfer receiver limits, Web Session-only own usage, admin-only pagination, account isolation and metadata-only output. Existing project/history/theme/admin regression tests remain separate evidence. No production migration, cleanup or deployment was performed.
