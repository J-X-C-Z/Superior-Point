# v0.32 reference inspection (opt-in, not editor integration)

The formal editor has not been supplied/selected. The existing v0.32 HTML was inspected as **read-only reference material**. This module does not register an editor, change the home page, choose a final schema, or migrate projects into the framework core. The original HTML/JavaScript is never imported, evaluated, opened in a browser, or rewritten.

## API and preservation boundary

Explicitly import `adapters/reference-v032.js` when this inspection is wanted:

```js
import {
  importReferenceV032, importReferenceV032HTML,
  restoreReferenceV032, exportReferenceV032, inspectReferenceV032
} from './adapters/reference-v032.js';

const envelope = importReferenceV032(projectJSONText);
const report = inspectReferenceV032(envelope);
const restoredProject = restoreReferenceV032(envelope);
const restoredJSON = exportReferenceV032(envelope);
```

- Import produces `{format: 'superior-point-reference-v032-envelope', envelopeVersion: 1, referenceOnly: true, project}`. This is **not** a canonical framework document and must not be sent to its renderer or mutation APIs.
- Restore produces a detached copy of the original project. Export produces only project JSON, not executable HTML. No file or external state is written.
- Accepted JSON values, object/slide order, source IDs, unknown fields, image properties, comments/replies, connectors, group membership, review history and slide links round-trip unchanged. Whitespace/property ordering in the original JSON text is not a preservation promise.
- Envelope snapshots and report data are detached. No normalization, UUID replacement, inferred defaults, cropping clamp, orphan repair, URL loading, markup insertion, or object conversion occurs.
- Core safe-JSON validation rejects cycles, non-finite numbers, non-JSON values, exotic object prototypes, and keys named `__proto__`, `prototype`, or `constructor` at any depth. These unsafe inputs fail rather than being partially discarded. Only ordinary JSON inputs are supported.
- The structural gate requires a `version: 1` project with a string `name`, positive finite `width`/`height`, and at least one slide with an `objects` array of objects. It is a reference-shape gate, **not proof that an arbitrary file came from v0.32**: the reference project's `version: 1` is not an editor-release identifier.
- Missing/duplicate IDs, unknown object types, invalid geometry, and dangling known references are diagnostics, not repairs. The inspection report is not an exhaustive editor validator.

## Actual model observed

The following observations came from `v032-reference.js`, read as text:

| Source location | Observed contract | Framework gap |
| --- | --- | --- |
| Lines 322–340, constructors | `makeText`, `makeShape`, `makeTable`, `makePath`, `makeChart`, `makeSlide`; objects use `id,type,x,y,w,h,rotation,opacity` plus per-type fields | Core shares some geometry fields but uses `elements`, not `objects` |
| Lines 535–616, demo result | `{version:1,name,width,height,themeAccent,slides}` | Candidate `name→title`, `width/height→canvas` mappings only |
| Lines 767–777, history/commit | `JSON.stringify(deck)` snapshots; commit records review changes then stores snapshot, trims history and schedules autosave | No shared command/history lifecycle wired yet |
| Lines 2785–2840, normalizer | Rebuilds deck and slides, regenerates slide/object IDs, maps links/anchors, clamps/defaults fields and filters types | Cannot be used for a lossless preservation round trip |
| Line 2863, JSON download | `JSON.stringify(deck,null,2)` | Reference envelope exports this data model without invoking editor commit |
| Lines 3294–3299, Reveal export | Inert `script[type="application/json"]#superior-point-project` contains the deck | Different marker/model from framework `#sp-document` |

The report supplies proposed field mappings without constructing or selecting a canonical migration:

- `slides[].objects → slides[].elements` is a candidate structural rename, not sufficient compatibility.
- Connector endpoints `fromId/toId` differ from core `sourceId/targetId`.
- Shared object `groupId` membership differs from core explicit group objects with `children[]`.
- `slide.comments[].objectId` anchors, replies, status and review fields need a comment contract. Existing IDs are kept exactly.
- `object.slideLinkId` and `reviewHistory[].slideId` refer to source slide IDs.
- `anim`, `motionEffects`, duration/delay/trigger fields and per-slide transitions differ from canonical animation records.
- Theme/master/background, hidden slides, rich-text runs, tables/merges/cell styles, charts, paths, ink, links and audio/video need separate editor-specific verification.

## Image contract and rendering limits

Reference source lines 309–310 and 1725–1730 show:

- `src` holds the image source; `fit` is contain/cover/fill.
- `crop` is `[left, top, right, bottom]` using normalized fractions. Reference rendering clamps values and resizes/offsets the image inside a clip. This module preserves raw values without applying those visual transforms.
- `brightness`, `contrast`, `saturation` and `grayscale` are percent-style filter values (defaults 100/100/100/0).
- `flipH`/`flipV` control image scale signs; `cornerRadius` applies to clipping.
- Rotation, opacity, shadow, stroke, alt text and other unknown properties also remain preserved.

The generic renderer is not equivalent. It does not establish the reference editor's crop/filter/flip/rich text/theme/group/timeline behavior. Every inspected image receives `IMAGE_RENDERING_NOT_VERIFIED`, and report capabilities explicitly set `visualEquivalence`, `playbackEquivalence` and `editableIntegration` to false. Resource strings remain inert data: successful preservation does not approve or sanitize those strings for rendering, network access, or offline export. Framework resource validation remains a separate layer. The inspection report now also classifies whether each source passes the strict embedded-raster boundary, without changing or fetching its bytes. Invalid, remote or SVG sources stay preserved in the envelope but are flagged as unsupported for framework export.

## HTML safety and scope

`importReferenceV032HTML` extracts a single inert JSON script using narrow text processing. It supports the reference export's quoted `type="application/json"` and `id="superior-point-project"` attributes in either order; single quotes are also accepted. Other payload attributes, duplicate payloads, absent payloads, malformed JSON and wrong project shapes fail closed. HTML comments and executable script bodies are skipped. No DOM is created, no scripts execute, and no resources load.

This is not a general-purpose HTML parser, renderer, sanitizer, or round-trip HTML editor. Use it only to inspect the known export structure; unusual/malformed HTML is unsupported. The original editor application HTML need not contain an exported project and is not treated as a project automatically. When authoring JSON scripts elsewhere, escape `<` as `\\u003c` so data cannot prematurely close its script tag; this module does not author HTML.

## Verification

Run `node --test tests/reference-v032.test.js`. The synthetic fixture reproduces observed source fields rather than executing source constructors. Tests cover semantic round-trip preservation, nonmutation, image fields, unknown data, stable IDs, group/connector/comment/slide references, explicit capability limitations, inert HTML extraction and rejected unsafe/ambiguous payloads. If the reference input files are present, tests verify their SHA-256 hashes; absence skips only that source-integrity test.

Inspected read-only source hashes:

- Extracted JS: `e75a1c4570a3bbf1162a89c666d6679751c51775c614d26070c3ad1f9f3539d5`
- Original HTML: `edb8f73588d9f15612d2d1b248b285371b6bb3e67f5752758b3bace5292bcc61`

## Required decisions before a real integration

Obtain the formal editor, then agree its authoritative model/ownership and mount/update/destroy/commit lifecycle. Decide lossless native-model storage versus an explicitly authorized migration. Prove identity/reference behavior for duplicate/delete/undo/redo and comments/groups/connectors. Compare image rendering and animation playback against the actual selected editor, including saved/reopened/offline exports. Keep this reference experiment out of UI registration and build entry points until those decisions are made.
