import {initProjectCardMotion} from './project-card-motion.js';
import {initHomeMotion} from './home-motion.js';
import {registerEditorAdapter} from './editor-adapter.js';
import {createLegacyEditorAdapter} from './legacy-editor-adapter.js';
// Test harnesses may explicitly exercise the generic preview. Production uses the candidate.
if(!globalThis.SP_DISABLE_EDITOR_CANDIDATE)registerEditorAdapter(createLegacyEditorAdapter());
initHomeMotion();
initProjectCardMotion();
import('./app.js');
