/** Core hidden and legacy visible:false both suppress paint, including grouped descendants. */
export function hiddenElementIds(slide){
 const elements=new Map(slide.elements.map(el=>[el.id,el])),hidden=new Set();
 const hide=id=>{if(hidden.has(id))return;hidden.add(id);const el=elements.get(id);if(el?.type==='group')for(const child of el.children||[])hide(child);};
 for(const el of slide.elements)if(el.hidden||el.visible===false)hide(el.id);
 return hidden;
}
