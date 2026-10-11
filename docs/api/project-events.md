# SP-074 Project revision events

`registerProjectEvents(app, {db, origin, actor})` registers a browser notification stream at `GET /api/v1/projects/:id/events?accountId=<expected-account-id>`. The expected account ID is an identity guard, not a credential. Cookies provide the existing Web Session; bearer authentication is rejected. Host and any Origin must match the configured canonical service origin. Active user/session and project ownership are rechecked before every metadata read. The endpoint does not grant platform admins access to another user's project.

The response is UTF-8 `text/event-stream`, with no cache and ingress buffering disabled through `X-Accel-Buffering: no`. It sends `event: revision`, numeric revision `id`, and JSON `{projectId, revision, deleted}`. No title, document, operation, token or session value is emitted. Soft-deleted projects send the deletion flag to their current owner. Ownership transfer terminates the old owner's stream.

This implementation detects committed metadata changes by polling PostgreSQL once per second per stream. It never enters the document write transaction or adds a notification dependency to writes. Queries are short transactions with a two-second statement timeout; no database connection is held for a stream's entire lifetime. Streams are limited to five per account and 100 per server. Polls are serialized, slow-client backpressure closes the stream, and disconnect or application pre-close releases timers/connections. Normal disconnects use native EventSource reconnection. Server polling intervals are available as a bounded test option.

On initial connection or reconnect, the server sends the current authoritative metadata. `Last-Event-ID` is syntax checked, but is not an authorization credential and does not request a full history replay. Changes during an outage are coalesced into the latest revision hint. Clients deduplicate revisions. Auth/session/ownership failure emits `access-revoked` with a sanitized error code and closes; transient failure emits `unavailable` and closes so clients can reconnect. Revocation is checked each poll and before new revision/heartbeat delivery.

The independent browser module exports:

```js
const subscription = subscribeProjectEvents({
  api,
  projectId,
  revision: persistedRevision,
  onRevision: ({revision, deleted}) => showRevisionHint(revision, deleted),
  onState: state => showNotificationConnectionState(state)
});
subscription.close();
```

Pass the last confirmed cloud revision, not the revision of unsaved local edits. The callback should display a prompt; it must not merge, synchronize, replace or save the current document. Own-save acknowledgments can be filtered against the current confirmed revision by the caller. Close the subscription when leaving/changing projects or accounts. The module also refuses events after its captured account identity changes. Unsupported EventSource reports `unavailable`; it does not silently enable document polling.

`web/app.js` currently polls complete documents and automatically merges updates. Completing SP-074 requires the main app owner to replace that polling with these notification callbacks while preserving IME/autosave/draft recovery paths. This batch supplies the independent backend and subscription module; it does not modify the editor or its integration artifacts.

Verification: real HTTP/PostgreSQL service tests cover Agent edits, failed CAS, initial metadata, reconnect with latest revisions, deletion, exact Host/Origin, account/session/owner checks, session revocation, ownership transfer, connection caps and application close. Browser-module tests cover hint delivery, deduplication, stale/malformed data, deletion, disconnect state, close, revoked access, account changes and unsupported EventSource. Full Chrome/Firefox UI prompt and no-draft-overwrite acceptance remain separate.

Protocol source: [WHATWG Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html). No production deployment or migration is needed for this endpoint.
