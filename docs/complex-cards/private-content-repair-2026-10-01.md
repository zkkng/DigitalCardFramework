# Private card content loading repair

## Failure and correction

The directory resolver used `credentials: "omit"` for every metadata and asset request. A signed-in viewer of a private host could load its page but could not load the protected card directory. Public local tests missed this condition.

The resolver now uses the browser's `same-origin` credential policy. Existing session cookies authenticate requests to the page's own origin; external origins must remain anonymous. This does not grant a role or bypass the host's authorization. `redirect: "error"`, declared-content checks, byte limits and integrity verification remain unchanged. No credentials are stored in a card package.

The public call stays `directoryResolver(baseURL, { digest, signal })`; no caller migration is required. A trusted host needing a different remote authentication scheme supplies its own resolver. This change does not add cross-origin credential forwarding.

## Evidence

- Reproduced the pre-fix failure with a cookie-protected synthetic card: `Unable to load integrity.json`.
- After the fix, the expanded browser audit passes all 30 checks in Edge 154 and Firefox 153, including protected metadata/assets and no cookies at a second origin on another port.
- All 13 directory/content audit Node tests pass.
- Windows WebKit 26.5 passes rendering and the protected-content checks, but fails the added cross-origin cookie isolation assertion. A native `fetch` with `credentials: "omit"` also sent the fixture cookie in this Windows test build. Do not treat this build as a passing cross-origin security qualification or as physical Safari evidence. The assertion remains enforced rather than skipped. Qualify this behavior on supported Safari/Linux WebKit builds before making that claim.

## Documentation impact and release lesson

Update future integration, authentication, private asset hosting and troubleshooting examples to include a session-protected content server. Include denied requests, successful signed-in loading, lazy media authentication, cross-origin credential isolation and visible host recovery. Artist material controls, manifest schemas, currencies and ownership semantics are unchanged: this repairs transport authentication only.

This is an implementation evidence record, not a published wiki entry. Security/hosting examples must distinguish server authorization, browser credential policy and the test browser's actual behavior. A successful deployment and public-local renderer tests do not establish that private hosted content works.
