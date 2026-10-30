# Publish the Windows Connector

The existing protected installer build can upload its completed installer to your API server. Uploading is configured on the build computer; publishing credentials are not packaged in the Connector.

1. Deploy the Server release-upload routes first. Set a private `CONNECTOR_RELEASE_TOKEN` of at least 32 characters on the Server and configure its persistent release storage.
2. Copy `.env.release.example` to `.env.release` inside `Connector`.
3. Set `CONNECTOR_RELEASE_SERVER_URL` to the API server origin, for example `https://sync.flowups.in` or `https://sync.flowups.in:8443`. Do not include a path such as `/api` or `/docs`. Set `CONNECTOR_RELEASE_TOKEN` to the same secret used by the Server. `.env.release` is ignored by Git. Environment variables override values in this file.
4. Set the desired version in `Connector/package.json`. Use three numeric components such as `0.0.1`, `0.0.2`, or `0.1.1`, with no more than 9 digits per component.
5. Run:

```powershell
npm run package:win
```

The protected build copies the current x64 installer into `release/`, then uploads that exact file with its version, architecture, and SHA-256 checksum. Once the server confirms publication, the build prints its download URL. The documentation download card reads the server's published release metadata.

If `CONNECTOR_RELEASE_SERVER_URL` is empty or absent, the command creates the local installer and skips uploading. If the URL is set, invalid settings fail before the protected build starts. Remote server URLs must use HTTPS; HTTP is accepted only for local loopback testing. A configured upload failure causes a non-zero command result and preserves the installer in `release/`.

To retry uploading an existing installer without rebuilding:

```powershell
npm run release:upload
```

Equivalent direct command: `node scripts/release-upload.js`. The manual uploader uses the current `package.json` version and its matching x64 installer. Add `--ia32` or `--arm64` when uploading an installer already built for that architecture.

The server accepts an unchanged version and checksum as an idempotent duplicate. A different installer cannot replace an already published version/architecture; increment the package version before creating a changed release. Publishing an older version does not replace the newest available version.

Uploads stream from disk and verify the server's returned version, architecture, size, and checksum. Redirects are rejected so that the publishing key is never forwarded to another URL. The optional `CONNECTOR_RELEASE_TIMEOUT_MS` limits the upload and response wait; its default is 600000 milliseconds.
