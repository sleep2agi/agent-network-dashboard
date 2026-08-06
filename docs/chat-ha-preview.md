# Reliable chat preview

One preview upgrade covers the Dashboard web app, desktop app, and CLI-hosted
Dashboard because all three use the same chat panel and `/api/hub/send` route.

## User-visible behavior

- Every send gets a stable, non-secret request id.
- A lost response is retried once with the same id, so the Hub returns the
  original task instead of creating a duplicate.
- A Hub that remains unavailable is reported as `delivery_unknown`; the UI does
  not display a false success.
- The optional network-scope fallback is also time-bounded, and definitive 4xx
  authentication/permission errors are returned immediately without retry.
- Text sends are written to the local outbox before the request. After a reload,
  an unresolved send is visible and can be retried safely.
- LAN HTTP/webview clients fall back to `getRandomValues` when `randomUUID` is
  unavailable; disabled or full browser storage degrades recovery but never
  blocks the network send.
- Offline-but-queued Hub responses are displayed as queued rather than failed.
- When history later contains the same request id, the pending local bubble is
  reconciled and removed.

This preview guarantees send/retry/display behavior. It does not guarantee that
an agent writes a non-empty task result; that remains the agent reply/completion
contract.

## Compatibility and limits

- Requires the matching preview Hub and Dashboard packages. Do not advertise
  this behavior for the current `latest` channel until its packages are promoted.
- Existing Hub clients that do not send `meta.client_request_id` are unchanged.
- File objects cannot be restored after a browser/app restart. Attachment retry
  remains available only in the current session; the durable outbox is text-only.
- The local outbox temporarily stores the full text of unconfirmed sends. It is
  scoped by authenticated user and network, expires after 24 hours, rejects
  entries over 32 KiB, and is cleared together with chat drafts on sign-out.

## Release gate

Before promotion: run the Docker reports in both repositories, perform an
independent source review from exact commit SHAs, then publish the compatible
preview package set together. Publishing or promoting `latest` is a separate
operator decision.
