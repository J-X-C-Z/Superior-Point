import type {SPDocument} from './document-core.js';
import type {Theme} from './theme-schema.js';
export interface MotionDiagnostic {renderer:'editor'|'reveal'|'editable-html'|'audience-html'|'pptx';status:'supported'|'degraded'|'refused';code:'THEME_MOTION_POLICY'|'EXISTING_ANIMATION'|'UNKNOWN_MOTION'|'SLIDE_TRANSITION';slideId:string;animationId?:string;behavior?:string;message:string}
export function inspectThemeCompatibility(document:SPDocument,options?:{theme?:Theme;slideIds?:string[]}):MotionDiagnostic[];
