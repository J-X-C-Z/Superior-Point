import {registerEditorAdapter} from './editor-adapter.js';
import {createLegacyEditorAdapter} from './legacy-editor-adapter.js';
// Test harnesses may explicitly exercise the generic preview. Production uses the candidate.
if(!globalThis.SP_DISABLE_EDITOR_CANDIDATE)registerEditorAdapter(createLegacyEditorAdapter());
import('./app.js');
