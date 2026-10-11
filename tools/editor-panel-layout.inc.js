// Workspace dimensions stay outside the presentation and its undo history.
function spPanelLayoutBoot(){
  for(const config of [
    {name:'ribbon',label:'调整功能区高度',value:96,min:96,max:220,direction:1,property:'--sp-ribbon-height'},
    {name:'notes',label:'调整备注面板高度',value:113,min:76,max:360,direction:-1,property:'--sp-notes-height'}
  ]){
    const panel=document.getElementById(config.name==='notes'?'notes-panel':'ribbon');
    const id='sp-panel-'+config.name+'-sash';
    if(!panel||document.getElementById(id))continue;
    const handle=document.createElement('div');
    handle.id=id;handle.className='sp-panel-sash';handle.tabIndex=0;
    handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','horizontal');
    handle.setAttribute('aria-label',config.label);handle.title='拖动调整大小 · 方向键微调 · 双击恢复';
    if(config.name==='ribbon')panel.after(handle);else panel.prepend(handle);
    let drag=null,frame=0;
    const height=()=>panel.getBoundingClientRect().height||config.value;
    function maximum(){
      const canvas=document.querySelector('.canvas-zone')?.getBoundingClientRect().height||0;
      return Math.max(config.min,Math.min(config.max,canvas?height()+canvas-180:config.max));
    }
    function set(value){
      const max=maximum(),size=Math.round(Math.max(config.min,Math.min(max,value)));
      panel.style.setProperty(config.property,size+'px');
      handle.setAttribute('aria-valuemin',String(config.min));handle.setAttribute('aria-valuemax',String(Math.round(max)));
      handle.setAttribute('aria-valuenow',String(size));handle.setAttribute('aria-valuetext',size+' 像素');
      if(!frame)frame=requestAnimationFrame(()=>{frame=0;fitCanvas();});
    }
    handle.setAttribute('aria-valuemin',String(config.min));handle.setAttribute('aria-valuemax',String(config.max));
    handle.setAttribute('aria-valuenow',String(Math.round(height())));
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0||panel.hidden||panel.classList.contains('collapsed'))return;
      drag={id:event.pointerId,y:event.clientY,height:height()};
      handle.setPointerCapture(event.pointerId);handle.classList.add('dragging');document.body.classList.add('sp-panel-resizing');
      event.preventDefault();
    });
    handle.addEventListener('pointermove',event=>{
      if(drag&&event.pointerId===drag.id)set(drag.height+(event.clientY-drag.y)*config.direction);
    });
    function stop(event){
      if(!drag||event.pointerId!==drag.id)return;
      const pointer=drag.id;drag=null;
      handle.classList.remove('dragging');document.body.classList.remove('sp-panel-resizing');
      if(handle.hasPointerCapture(pointer))handle.releasePointerCapture(pointer);
    }
    for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,stop);
    handle.addEventListener('dblclick',()=>set(config.value));
    handle.addEventListener('keydown',event=>{
      if(!['ArrowUp','ArrowDown','Home'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      set(event.key==='Home'?config.value:height()+(event.key==='ArrowDown'?10:-10)*config.direction);
    });
  }
}
