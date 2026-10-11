/** Add the document-backed theme library entry to the preserved v0.39 design ribbon. */
export function patchEditorThemeEntry(source){
 if(typeof source!=='string')throw new TypeError('Editor source must be a string');
 if(source.includes('data-action="sp-theme-entry"'))return source;
 const design=`group('设计主题',`;
 const index=source.indexOf(design);
 if(index<0||source.indexOf(design,index+design.length)>=0)throw new Error('Expected one v0.39 design-theme group');
 const entry=`group('主题库',\`<div class="sp35-preview-actions"><strong>\${safe(spBridgeThemeEntry?.name||'未应用库主题')}</strong><small>\${safe(spBridgeThemeEntry?.version?'固定快照 · v'+spBridgeThemeEntry.version:'当前文稿没有库主题快照')}</small><button class="sp35-feature" data-action="sp-theme-entry">浏览主题库</button><button class="sp35-feature" data-action="sp-theme-entry">应用库主题</button></div>\`),group('文稿内样式（原设计预设）',`;
 return source.slice(0,index)+entry+source.slice(index+design.length);
}
