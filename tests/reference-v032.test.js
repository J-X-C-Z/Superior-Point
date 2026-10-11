import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importReferenceV032, restoreReferenceV032, exportReferenceV032,
  importReferenceV032HTML, inspectReferenceV032 } from '../adapters/reference-v032.js';

// Synthetic fixture transcribed from inspected constructors/serialization fields.
// No reference editor script is imported or evaluated.
function fixture() {
  return { version: 1, name: 'Reference fixture', width: 1280, height: 720,
    themeId: 'noema', design: { paper: '#ffffff', custom: { value: 7 } },
    metadata: { author: 'Fixture', createdAt: '2026-10-10T00:00:00Z', unknown: [false, null] },
    customProject: { nested: ['untouched', { future: true }] },
    reviewHistory: [{ id: 'review1', slideId: 'slide1', action: 'Fixture', extra: 'kept' }],
    slides: [{ id: 'slide1', bg: '#fff', background: { type: 'solid', color: '#fff' },
      transition: 'morph', duration: 600, notes: 'Notes', customSlide: { x: 4 },
      comments: [{ id: 'comment1', objectId: 'image1', text: 'Inspect crop', status: 'resolved',
        replies: [{ id: 'reply1', text: 'Keep filters', customReply: 3 }], customComment: 1 }],
      objects: [
        { id: 'text1', type: 'text', x: 40, y: 30, w: 300, h: 50, text: 'Hello',
          color: '#161715', runs: [{ text: 'Hello', bold: true }], groupId: 'group1', slideLinkId: 'slide2' },
        { id: 'image1', name: 'Photo', type: 'image', x: 100, y: 100, w: 450, h: 300,
          src: 'data:image/png;base64,iVBORw0KGgo=', fit: 'cover', crop: [.1, .2, .15, .05],
          brightness: 120, contrast: 95, saturation: 110, grayscale: 15, flipH: true, flipV: true,
          cornerRadius: 17, opacity: .8, rotation: 13, shadow: true, stroke: '#334455', strokeWidth: 2,
          alt: 'Description', groupId: 'group1', anim: 'fade', customImage: { future: 'preserved' },
          motionEffects: [{ id: 'motion1', effect: 'fade', trigger: 'click', customMotion: [1,2] }] },
        { id: 'connector1', type: 'connector', x: 0, y: 0, w: 1, h: 1,
          fromId: 'text1', toId: 'image1', arrowEnd: true },
        { id: 'future1', type: 'future-widget', x: 1, y: 1, w: 5, h: 5, payload: { nested: true } }
      ] }, { id: 'slide2', bg: '#eee', hidden: true, objects: [] }] };
}
const html = project => `<!doctype html><html><body><script>throw new Error('MUST NOT RUN');</script><script type="application/json" id="superior-point-project">${JSON.stringify(project).replace(/</g, '\\u003c')}</script><script src="https://invalid.example/editor.js"></script></body></html>`;

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('lossless round trip preserves actual objects shape and all unknown fields without mutation', () => {
  const source = fixture(), before = JSON.stringify(source);
  freeze(source);
  const envelope = importReferenceV032(source);
  assert.equal(envelope.referenceOnly, true);
  assert.deepEqual(restoreReferenceV032(envelope), source);
  assert.deepEqual(JSON.parse(exportReferenceV032(envelope)), source);
  assert.equal(JSON.stringify(source), before);
  envelope.project.slides[0].objects[1].crop[0] = .4;
  assert.equal(source.slides[0].objects[1].crop[0], .1);
  const restored = restoreReferenceV032(envelope);
  restored.customProject.nested[1].future = false;
  assert.equal(envelope.project.customProject.nested[1].future, true);
});

test('report explicitly denies integration, migration and renderer equivalence', () => {
  const envelope = importReferenceV032(fixture());
  const report = inspectReferenceV032(envelope);
  assert.equal(report.selectedEditor, false);
  assert.equal(report.schemaMigrationApproved, false);
  assert.equal(report.capabilities.visualEquivalence, false);
  assert.equal(report.capabilities.editableIntegration, false);
  assert.equal(report.capabilities.executesSource, false);
  assert.equal(report.capabilities.fetchesResources, false);
  assert.deepEqual(report.groups, [{ slideId: 'slide1', groupId: 'group1', members: ['text1','image1'] }]);
  assert.equal(report.references.length, 4);
  assert.ok(report.references.every(r => r.resolved));
  const props = report.imageProperties[0].properties;
  for (const key of ['src','crop','fit','brightness','contrast','saturation','grayscale','flipH','flipV','cornerRadius']) {
    assert.deepEqual(props[key], fixture().slides[0].objects[1][key]);
  }
  assert.ok(report.issues.some(i => i.code === 'UNKNOWN_OBJECT_TYPE_PRESERVED'));
  assert.ok(report.integrationGaps.some(s => s.includes('elements, not objects')));
  assert.ok(report.proposedFieldMapping.some(m => m.source.includes('fromId')));
  props.crop[0] = 999;
  assert.equal(envelope.project.slides[0].objects[1].crop[0], .1);
});

test('dangling anchors, invalid geometry and duplicate IDs are reported without repair', () => {
  const source = fixture();
  source.slides[0].comments[0].objectId = 'missing';
  source.slides[0].objects[2].toId = 'orphan:old';
  source.slides[0].objects[0].slideLinkId = 'missing-slide';
  source.slides[0].objects[1].w = -1;
  source.slides[1].id = 'slide1';
  source.reviewHistory[0].slideId = 'missing-slide';
  const envelope = importReferenceV032(source), report = inspectReferenceV032(envelope);
  assert.equal(report.issues.filter(i => i.code === 'DANGLING_REFERENCE').length, 4);
  assert.ok(report.issues.some(i => i.code === 'INVALID_OR_DUPLICATE_ID'));
  assert.ok(report.issues.some(i => i.code === 'INVALID_GEOMETRY_PRESERVED'));
  assert.deepEqual(restoreReferenceV032(envelope), source);
});

test('HTML extraction reads only inert payload; never executes scripts or loads resources', () => {
  const source = fixture();
  source.name = '</script><script>globalThis.__v032Executed=true</script>';
  source.slides[0].objects[1].src = 'https://invalid.example/image.svg';
  globalThis.__v032Executed = false;
  const envelope = importReferenceV032HTML(html(source));
  assert.deepEqual(restoreReferenceV032(envelope), source);
  assert.equal(globalThis.__v032Executed, false);
  assert.equal(inspectReferenceV032(envelope).capabilities.visualEquivalence, false);
  delete globalThis.__v032Executed;
});

test('HTML parser fails closed for absent, multiple, active, malformed and non-project payloads', () => {
  const source = html(fixture());
  assert.throws(() => importReferenceV032HTML('<script>throw 1</script>'), /exactly one/);
  assert.throws(() => importReferenceV032HTML(source + source), /exactly one/);
  assert.throws(() => importReferenceV032HTML(source.replace('application/json', 'text/javascript')), /attributes/);
  assert.throws(() => importReferenceV032HTML(source.replace('id="superior-point-project"', 'id="superior-point-project" src="evil.js"')), /attributes/);
  assert.throws(() => importReferenceV032HTML(source.replace('"version":1', '"version":')), SyntaxError);
  assert.throws(() => importReferenceV032HTML(html({ slides: [] })), /v0.32-shaped/);
  assert.throws(() => importReferenceV032HTML(`<!--${source}-->`), /exactly one/);
  assert.deepEqual(restoreReferenceV032(importReferenceV032HTML(source.replace('type="application/json" id="superior-point-project"', "id='superior-point-project' type='application/json'"))), fixture());
});

test('unsafe JSON and wrong envelope/project models are rejected, never silently migrated', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const json = JSON.stringify(fixture()).replace('"version":1', `"${key}":{},"version":1`);
    assert.throws(() => importReferenceV032(json), /Unsafe key/);
  }
  assert.equal({}.polluted, undefined);
  const source = fixture(); source.self = source;
  assert.throws(() => importReferenceV032(source), /acyclic/);
  assert.throws(() => importReferenceV032({ ...fixture(), version: 2 }), /v0.32-shaped/);
  assert.throws(() => importReferenceV032({ ...fixture(), slides: [{ elements: [] }] }), /v0.32-shaped/);
  assert.throws(() => restoreReferenceV032({ project: fixture() }), /reference-only/);
});

test('read-only reference files remain byte-for-byte unchanged when present', async t => {
  const files = [
    ['../../input/v032-reference.js', 'e75a1c4570a3bbf1162a89c666d6679751c51775c614d26070c3ad1f9f3539d5'],
    ['../../input/SuperiorPoint_v0.32_Object_Refined.html', 'edb8f73588d9f15612d2d1b248b285371b6bb3e67f5752758b3bace5292bcc61']
  ];
  for (const [path, expected] of files) {
    let content;
    try { content = await readFile(new URL(path, import.meta.url)); }
    catch (error) { if (error.code === 'ENOENT') { t.skip('Reference input is not distributed with the framework'); return; } throw error; }
    assert.equal(createHash('sha256').update(content).digest('hex'), expected);
  }
});
test('reference inspector distinguishes preserved image data from supported renderable resources',()=>{const raw=fixture();raw.slides[0].objects[1].src='javascript:alert(1)';const envelope=importReferenceV032(raw),report=inspectReferenceV032(envelope);assert.equal(report.imageProperties[0].resource.supportedForFrameworkExport,false);assert.ok(report.issues.some(i=>i.code==='IMAGE_RESOURCE_UNSUPPORTED'));assert.equal(restoreReferenceV032(envelope).slides[0].objects[1].src,'javascript:alert(1)');});
