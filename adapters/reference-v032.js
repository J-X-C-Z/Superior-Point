/** Read-only, explicitly imported reference tooling. Not a selected editor adapter. */
import { cloneJSON } from '../core/document-core.js';
import { inspectRasterDataURL } from '../io/image-assets.js';

export const REFERENCE_V032_FORMAT = 'superior-point-reference-v032-envelope';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const types = new Set(['text', 'shape', 'image', 'audio', 'video', 'table', 'connector', 'chart', 'ink', 'path']);
const mapping = Object.freeze([
  ['name', 'title', 'Candidate name mapping only'],
  ['width / height', 'canvas.width / canvas.height', 'Candidate geometry mapping only'],
  ['slides[].objects', 'slides[].elements', 'Different model; not automatically converted'],
  ['objects[].fromId / toId', 'elements[].sourceId / targetId', 'Connector references require explicit translation'],
  ['objects[].groupId', 'group elements with children[]', 'Shared membership is not an explicit group object'],
  ['slides[].comments[].objectId', 'No implemented canonical comment contract', 'Keep anchors and replies unchanged'],
  ['objects[].anim / motionEffects', 'slides[].animations', 'Different timelines, effects and triggers'],
  ['objects[].src / crop / fit / brightness / contrast / saturation / grayscale / flipH / flipV', 'Image rendering adapter required', 'Preservation does not establish visual equivalence']
]);

function readProject(input) {
  // cloneJSON rejects cycles, non-JSON values, exotic prototypes and prototype-pollution keys.
  if(typeof input==='string'&&input.length>32*1024*1024)throw new TypeError('Reference JSON exceeds size limit');
  const project = cloneJSON(typeof input === 'string' ? JSON.parse(input) : input);
  if (!object(project) || project.version !== 1 || typeof project.name !== 'string' ||
      !Number.isFinite(project.width) || project.width <= 0 ||
      !Number.isFinite(project.height) || project.height <= 0 ||
      !Array.isArray(project.slides) || !project.slides.length ||
      project.slides.some(slide => !object(slide) || !Array.isArray(slide.objects) ||
        slide.objects.some(item => !object(item)))) {
    throw new TypeError('Expected a v0.32-shaped version:1 project with name, dimensions and slides[].objects');
  }
  return project;
}

/** Preserve accepted JSON values exactly, without calling the editor normalizer. */
export function importReferenceV032(input) {
  return { format: REFERENCE_V032_FORMAT, envelopeVersion: 1, referenceOnly: true, project: readProject(input) };
}

export function restoreReferenceV032(envelope) {
  if (!object(envelope) || envelope.format !== REFERENCE_V032_FORMAT ||
      envelope.envelopeVersion !== 1 || envelope.referenceOnly !== true) {
    throw new TypeError('Expected an explicit reference-only v0.32 envelope');
  }
  return readProject(envelope.project);
}

/** Project JSON only, never executable HTML. No writes or mutation of the envelope. */
export function exportReferenceV032(envelope) {
  return JSON.stringify(restoreReferenceV032(envelope), null, 2);
}

/**
 * Narrow extraction of the reference export's two-attribute inert JSON script.
 * This is text processing, not a browser import: no eval, DOM insertion or fetch.
 * Arbitrary HTML is not supported. Executable script bodies and comments are skipped.
 */
export function importReferenceV032HTML(html) {
  if (typeof html !== 'string'||html.length>64*1024*1024) throw new TypeError('Expected bounded HTML text');
  const candidates = [];
  const tokens = /<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(tokens)) {
    if (match[1] === undefined) continue;
    const attrs = match[1].trim();
    const first = /^type\s*=\s*(["'])application\/json\1\s+id\s*=\s*(["'])superior-point-project\2$/i;
    const second = /^id\s*=\s*(["'])superior-point-project\1\s+type\s*=\s*(["'])application\/json\2$/i;
    if (first.test(attrs) || second.test(attrs)) candidates.push(match[2]);
    else if (/\bsuperior-point-project\b/i.test(attrs)) throw new TypeError('Unsupported reference payload script attributes');
  }
  if (candidates.length !== 1) throw new TypeError('Expected exactly one inert superior-point-project JSON payload');
  return importReferenceV032(candidates[0]);
}

/** Diagnostic field mapping, deliberately not a canonical document or migration. */
export function inspectReferenceV032(envelope) {
  const project = restoreReferenceV032(envelope);
  const issues = [], imageProperties = [], references = [], groups = [];
  const counts = new Map();
  const slideIds = new Set(project.slides.map(s => s.id));
  const allIds = new Set();
  const checkId = (id, path) => {
    if (typeof id !== 'string' || !id || allIds.has(id)) issues.push({ code: 'INVALID_OR_DUPLICATE_ID', path });
    else allIds.add(id);
  };
  for (const [si, slide] of project.slides.entries()) {
    const path = `slides[${si}]`;
    checkId(slide.id, `${path}.id`);
    const ids = new Set(slide.objects.map(o => o.id)), memberships = new Map();
    const ref = (target, key, targets) => {
      if (target === undefined || target === '') return;
      const resolved = targets.has(target);
      references.push({ path: key, target, resolved });
      if (!resolved) issues.push({ code: 'DANGLING_REFERENCE', path: key, target });
    };
    for (const [oi, item] of slide.objects.entries()) {
      const op = `${path}.objects[${oi}]`;
      checkId(item.id, `${op}.id`);
      const type = typeof item.type === 'string' ? item.type : '(missing)';
      counts.set(type, (counts.get(type) || 0) + 1);
      if (!types.has(type)) issues.push({ code: 'UNKNOWN_OBJECT_TYPE_PRESERVED', path: `${op}.type`, value: type });
      if (!['x','y','w','h'].every(k => Number.isFinite(item[k])) || item.w < 0 || item.h < 0) {
        issues.push({ code: 'INVALID_GEOMETRY_PRESERVED', path: op });
      }
      if (item.groupId) {
        if (!memberships.has(item.groupId)) memberships.set(item.groupId, []);
        memberships.get(item.groupId).push(item.id ?? null);
      }
      if (item.type === 'connector') {
        ref(item.fromId, `${op}.fromId`, ids);
        ref(item.toId, `${op}.toId`, ids);
      }
      ref(item.slideLinkId, `${op}.slideLinkId`, slideIds);
      if (item.type === 'image') {
        const properties = {};
        for (const key of ['src','alt','fit','crop','brightness','contrast','saturation','grayscale','flipH','flipV','cornerRadius','rotation','opacity','shadow','stroke','strokeWidth']) {
          if (Object.hasOwn(item, key)) properties[key] = item[key];
        }
        let resource={supportedForFrameworkExport:false,reason:'Only validated embedded raster images are supported'};try{resource={supportedForFrameworkExport:true,...inspectRasterDataURL(item.src)};}catch(error){resource.reason=error.message;}
        imageProperties.push({ path: op, objectId: item.id ?? null, properties, resource });
        if(!resource.supportedForFrameworkExport)issues.push({code:'IMAGE_RESOURCE_UNSUPPORTED',path:op+'.src',reason:resource.reason});
        issues.push({ code: 'IMAGE_RENDERING_NOT_VERIFIED', path: op });
      }
    }
    for (const [groupId, members] of memberships) groups.push({ slideId: slide.id ?? null, groupId, members });
    for (const [ci, comment] of (Array.isArray(slide.comments) ? slide.comments : []).entries()) {
      if (object(comment)) ref(comment.objectId, `${path}.comments[${ci}].objectId`, ids);
    }
  }
  for (const [i, event] of (Array.isArray(project.reviewHistory) ? project.reviewHistory : []).entries()) {
    if (object(event) && event.slideId && !slideIds.has(event.slideId)) {
      issues.push({ code: 'DANGLING_REFERENCE', path: `reviewHistory[${i}].slideId`, target: event.slideId });
    }
  }
  return cloneJSON({
    status: 'reference-only', selectedEditor: false, schemaMigrationApproved: false,
    capabilities: { losslessJSONRoundTrip: true, stableSourceIds: true, executesSource: false,
      fetchesResources: false, editableIntegration: false, visualEquivalence: false, playbackEquivalence: false },
    summary: { title: project.name, width: project.width, height: project.height,
      slides: project.slides.length, objects: project.slides.reduce((n, s) => n + s.objects.length, 0), types: [...counts].map(([type, count]) => ({ type, count })) },
    proposedFieldMapping: mapping.map(([source, target, caveat]) => ({ source, target, caveat })),
    imageProperties, references, groups, issues,
    integrationGaps: [
      'The formal editor is still required. This module is not registered in the UI.',
      'The generic renderer expects elements, not objects; it is not the v0.32 renderer.',
      'Image crop, filters, flip, rounded clipping, styling and fit require dedicated rendering verification.',
      'Rich text, theme/master/background, shapes, tables/merges, charts, paths, media and hyperlinks need editor-specific mapping.',
      'Group membership, connector/comment anchors, review history and slide links need an explicit reference contract.',
      'Motion timelines, triggers, transitions, hidden slides and playback are not equivalent.',
      'Source URLs and markup are inert stored data, not approved or sanitized renderable resources.',
      'Original normalizeProject regenerates IDs and normalizes/drops fields; it is never invoked here.'
    ]
  });
}
