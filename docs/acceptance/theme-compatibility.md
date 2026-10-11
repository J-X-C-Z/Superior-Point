# Theme compatibility acceptance

Date: 2026-10-11. This record covers the current v1.1 workspace changes; it does not change the application release version or claim a production deployment.

## Verified

- Core preview tests exercised all six built-in themes at 16:9 and 4:3, and checked that the themes keep four sample slides and survive the native editor round trip. Package tests checked allowed image signatures, asset hashes, licenses, bounds, immutable references, and rejection of SVG or executable/external content.
- In a real Codex in-app browser session, a theme-based project was created, then another theme was applied to an existing project. The accepted preserve flow retained a manual style override and project data; one editor undo returned the previous theme while keeping the manual override. The project was saved, reloaded, downloaded as editable HTML, and read back. The downloaded document retained all four slides, four speaker notes, one image asset, and the fixed theme reference.
- The workspace test log `/private/tmp/sp-v11-final-tests.log` reports 252 tests, 251 passed, 0 failed, and 1 skipped. The service test log `/private/tmp/sp-v11-service-tests.log` reports 57 passed and 0 failed. These are test results, not browser-wide visual acceptance.

## Compatibility limits

- Theme previews are four static SVG samples from the generic renderer. They do not reproduce animation playback or promise pixel equality with the editor.
- Package image validation accepts PNG, JPEG, and WebP signatures and checks their declared hashes and licenses. SVG, HTML, executable content, external resource loading, and font binaries are rejected. Signature validation is not a full image decoder or malware scan.
- Fonts are references to installed/system fonts with declared fallbacks and licenses. The product does not distribute fonts. A missing font or different browser metrics can change typography; preview line height may degrade.
- Charts rendered to generic SVG can use different axis treatment from the editor's native chart rendering.
- No PowerPoint visual acceptance or Firefox theme visual acceptance is recorded here. Do not infer either from the core tests or the in-app-browser flow.

## Evidence scope

This acceptance records the named test logs and one real in-app-browser workflow. It does not certify every browser, every theme against every presentation, PPTX fidelity, remote MCP, or the deployed service. The project remains `0.1.0-alpha`; Roadmap v1.1 is a roadmap revision, not an application version.
