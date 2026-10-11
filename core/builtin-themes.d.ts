import type {Theme} from './theme-schema.js';
export function listBuiltinThemes():Theme[];
export function getBuiltinTheme(id:string):Theme|null;
