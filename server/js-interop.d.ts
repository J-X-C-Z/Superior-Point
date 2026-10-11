declare module '*io/html.js' {
 export function exportHTML(document: import('../core/document-core.js').SPDocument, options?:{audience?:boolean}):Promise<string>;
 export function renderSlideSVG(document: import('../core/document-core.js').SPDocument,slideId:string):string;
 export function inspectRenderCompatibility(document: import('../core/document-core.js').SPDocument):{hasKnownGaps:boolean;warnings:unknown[];[key:string]:unknown};
}
