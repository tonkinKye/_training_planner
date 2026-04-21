Vendored MSAL Browser

This directory contains the checked-in browser auth library used by the app:

- `msal-browser-2.39.0.min.js`

Why it is vendored:

- the app no longer trusts runtime CDN loading for the auth library
- upgrades are explicit, reviewed, and committed with the app

Upgrade procedure:

1. Download the official npm tarball for the target version:
   `npm view @azure/msal-browser@<version> dist.tarball`
2. Download that tarball.
3. Extract `package/lib/msal-browser.min.js`.
4. Save it here as `msal-browser-<version>.min.js`.
5. Update [index.html](../index.html) to reference the new filename.
6. Remove the old vendored file.
7. Run `npm test`.
8. Commit the vendored file and version bump together.

Source of truth:

- package: `@azure/msal-browser`
- channel: official npm package tarball
