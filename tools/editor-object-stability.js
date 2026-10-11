/** Fix native object operations at integration time; keep the archived editor intact. */
export function patchObjectStability(source){
  const replace=(label,needle,value)=>{
    const hits=source.split(needle).length-1;
    if(hits!==1)throw Error(`${label}: expected one exact source match, got ${hits}`);
    source=source.replace(needle,()=>value);
  };
  replace('unique object selection',
    'selectedIds=(expand?expandGrouped(ids):ids).filter(id=>all.has(id));',
    'selectedIds=[...new Set(expand?expandGrouped(ids):ids)].filter(id=>all.has(id));');
  replace('context-menu group selection',
    'if(node){const id=node.dataset.id;if(!selectedIds.includes(id)){selectedIds=[id];selectedId=id;renderAll();}}',
    'if(node){const id=node.dataset.id;if(!selectedIds.includes(id))setSelection([id]);}');
  replace('canvas pointer keyboard focus',
    "    if(e.target.closest('[data-sp32-rotate]')){",
    "    // The persistent mount keeps iframe keyboard focus when selection redraws its stage.\n    const focusMount=$('#stage-mount');focusMount.tabIndex=-1;focusMount.focus({preventScroll:true});\n    if(e.target.closest('[data-sp32-rotate]')){");
  const reorder=source.slice(source.indexOf('  function reorderObject(dir){'),source.indexOf('  function layerEdge(front){'));
  replace('shared layer lock handling',reorder,'  function reorderObject(dir){sp38MoveLayer(dir);}\n');
  replace('locked edge reorder',
    'const arr=curSlide().objects,ids=new Set(selectedIds);if(!ids.size)return;',
    "const arr=curSlide().objects,ids=new Set(selectedIds);if(!ids.size)return;\n    if(selectedObjects().some(o=>o.locked)){toast('包含锁定对象，先解锁后再调整层级',true);return;}");
  replace('locked ungroup',
    "    objects.forEach(o=>delete o.groupId);commit();renderAll();toast('已取消组合');",
    "    if(objects.some(o=>o.locked)){toast('锁定对象无法取消组合，请先解锁',true);return;}\n    objects.forEach(o=>delete o.groupId);commit();renderAll();toast('已取消组合');");
  replace('copied Core slide references',
    '    return copy;\n  }\n  function v11CopySlides()',
    `    for(const group of copy.spCanonicalGroups||[]){const prev=group.id;if(!grpMap.has(prev))grpMap.set(prev,uuid());group.id=grpMap.get(prev);idMap.set(prev,group.id);group.children=group.children.map(id=>idMap.get(id)||id);}
    const animationIds=new Map();
    for(const animation of copy.animations||[]){const prev=animation.id;animation.id=uuid();animationIds.set(prev,animation.id);animation.targetId=idMap.get(animation.targetId)||animation.targetId;}
    for(const obj of copy.objects||[]){const source=obj.spEditorMapping;
      if(source?.groupId)source.groupId=grpMap.get(source.groupId)||source.groupId;
      if(source?.animation){source.animation.targetId=obj.id;for(const animation of source.animation.canonical||[]){animation.id=animationIds.get(animation.id)||animation.id;animation.targetId=idMap.get(animation.targetId)||animation.targetId;}}
    }
    if(copy.spEditorMapping?.groupOrder)copy.spEditorMapping.groupOrder=copy.spEditorMapping.groupOrder.map(id=>idMap.get(id)||id);
    (copy.comments||[]).forEach(c=>{c.id=uuid();c.objectId=idMap.get(c.objectId)||'';c.replies=(c.replies||[]).map(r=>({...r,id:uuid()}));});
    return copy;
  }
  function v11CopySlides()`);
  const duplicate=source.split('\n').find(line=>line.startsWith('  function duplicateSlide(){'));
  replace('shared slide duplication remap',duplicate,'  function duplicateSlide(){const s=v11RemapSlide(curSlide());'+duplicate.slice(duplicate.indexOf('deck.slides.splice')));
  return source;
}
