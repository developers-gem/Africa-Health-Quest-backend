# API documentation

`openapi.json` is generated from `packages/api-contracts` (`npm run openapi -w @ahq/api-contracts`) and is
also served live at `GET /openapi.json`. CI fails if the committed file is stale.

Clients:

- Web sends no platform header (or `X-Client-Platform: web`) and uses `credentials: "include"` for
  the refresh cookie.
- Flutter sends `X-Client-Platform: mobile`, stores the refresh token in secure storage, and sends
  it in the body to `/auth/refresh` and `/auth/logout`.
- Refresh calls must be single-flight per client: a second concurrent refresh with the same token
  is treated as token theft and ends the session.
