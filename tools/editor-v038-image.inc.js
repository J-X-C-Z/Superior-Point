  // Candidate-only image I/O. Decoding never mutates a document or recovery draft.
  function spBridgeCheckPictureContext(context){
    if(!spBridgeStarted||spBridgeReadOnly||spBridgeFailure||deck!==context.deck||spBridgeEpoch!==context.epoch||!deck.slides.includes(context.slide)){
      const error=Error('图片操作已取消：原文稿或页面已关闭、更新，或写入权已失效');
      error.code='SP_PICTURE_CONTEXT_LOST';throw error;
    }
  }
  function spBridgePictureContext(){
    const context={deck,slide:curSlide(),epoch:spBridgeEpoch};spBridgeCheckPictureContext(context);return context;
  }
  async function spBridgeReadPicture(file,context){
    spBridgeCheckPictureContext(context);
    if(file.size>spBridgeRasterAssets.IMAGE_LIMITS.maxBytes)throw Error('单张图片不能超过 16 MiB');
    if(!/^image\/(png|jpeg|jpg|gif|webp)$/i.test(file.type||''))throw Error('候选编辑器仅支持 PNG、JPG、WebP 和 GIF 图片，暂不支持 SVG');
    const src=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(Error('图片读取失败'));reader.onabort=()=>reject(Error('图片读取已取消'));reader.readAsDataURL(file);
    });
    spBridgeCheckPictureContext(context);
    // Validate actual encoded bytes, MIME/signature, dimensions and container limits
    // before codec work. A caller's declared File.size is not a trusted byte budget.
    spBridgeRasterAssets.inspectRasterDataURL(src);
    const image=new Image();
    try{
      image.src=src;await image.decode();
      if(!Number.isFinite(image.naturalWidth)||!Number.isFinite(image.naturalHeight)||image.naturalWidth<=0||image.naturalHeight<=0)throw Error('图片解码后尺寸无效');
      spBridgeCheckPictureContext(context);
      return {src,width:image.naturalWidth,height:image.naturalHeight};
    }finally{image.src='';}
  }
  function spBridgePictureObject(file,decoded,context,at,options={}){
    const canvas=context.deck,ratio=decoded.width/decoded.height;
    const boxW=Math.max(16,Math.min(options.maxWidth||460,canvas.width*.85)),boxH=Math.max(16,Math.min(options.maxHeight||390,canvas.height*.74));
    let w=boxW,h=w/ratio;if(h>boxH){h=boxH;w=h*ratio;}w=Math.max(8,w);h=Math.max(8,h);
    return {id:uuid(),name:file.name,type:'image',src:decoded.src,x:round(clamp(at?at.x-w/2:(canvas.width-w)/2,0,Math.max(0,canvas.width-w))),y:round(clamp(at?at.y-h/2:(canvas.height-h)/2,0,Math.max(0,canvas.height-h))),w:round(w),h:round(h),rotation:0,opacity:1,fit:'contain',lockAspect:true,picturePreset:'plain',alt:file.name,anim:'none'};
  }
  function spBridgeFinishPictureChange(context,objects=null){
    spBridgeCheckPictureContext(context);
    const current=curSlide()===context.slide;
    // A user may have started typing while the image decoded. Preserve that draft
    // before a same-page render, without creating an extra history transaction.
    if(current)spBridgeCaptureDraft();
    spBridgeCheckPictureContext(context);
    if(objects){
      context.slide.objects.push(...objects);
      if(current){selectedIds=objects.map(o=>o.id);selectedId=selectedIds.at(-1)||null;}
    }
    commit();
    if(current){if(v8IsMobile()&&v8Sheet)v8CloseSheets();renderAll();}
    else{renderThumbs();renderStatus();}
  }
  async function spBridgeInsertPicture(file,at=null,options={}){
    if(!file)return null;
    try{
      const context=spBridgePictureContext(),decoded=await spBridgeReadPicture(file,context);
      const object=spBridgePictureObject(file,decoded,context,at,options);
      spBridgeFinishPictureChange(context,[object]);toast('已插入图片');return object.id;
    }catch(error){toast('无法插入图片：'+error.message,true);return null;}
  }
  async function spBridgeInsertPictures(input){
    const files=[...input].slice(0,6);if(!files.length)return;
    try{
      const context=spBridgePictureContext(),cols=Math.min(3,files.length),rows=Math.ceil(files.length/cols),gap=36;
      const cellW=(context.deck.width-gap*(cols+1))/cols,cellH=(context.deck.height-gap*(rows+1))/rows;
      const objects=[];let total=0,failed=0;
      for(let i=0;i<files.length;i++){
        spBridgeCheckPictureContext(context);
        if(total+files[i].size>45*1024*1024){failed+=files.length-i;toast('每批图片总量上限为 45 MB；超出部分未导入',true);break;}
        total+=files[i].size;
        try{
          const decoded=await spBridgeReadPicture(files[i],context);
          const at={x:gap+(i%cols+.5)*(cellW+gap)-gap/2,y:gap+(Math.floor(i/cols)+.5)*(cellH+gap)-gap/2};
          objects.push(spBridgePictureObject(files[i],decoded,context,at,{maxWidth:cellW,maxHeight:cellH}));
        }catch(error){
          spBridgeCheckPictureContext(context);
          failed++;toast('未插入「'+files[i].name+'」：'+error.message,true);
        }
      }
      spBridgeCheckPictureContext(context);
      if(!objects.length)return;
      spBridgeFinishPictureChange(context,objects);
      toast('已插入 '+objects.length+' 张图片'+(failed?'；'+failed+' 张未导入':''));
    }catch(error){toast('图片批量操作已取消：'+error.message,true);}
  }
  async function spBridgeReplacePicture(file){
    if(!file)return;
    try{
      const context=spBridgePictureContext(),object=sp33SelectedImage(),originalSource=object?.src;
      if(!object||object.locked)throw Error('请先选中未锁定的图片');
      const decoded=await spBridgeReadPicture(file,context);
      spBridgeCheckPictureContext(context);
      if(!context.slide.objects.includes(object)||object.locked||object.src!==originalSource)throw Error('原图片已删除、锁定或由其他操作更换');
      if(curSlide()===context.slide)spBridgeCaptureDraft();
      spBridgeCheckPictureContext(context);
      object.src=decoded.src;object.alt=file.name;object.name=file.name;
      if(sp33CropSession?.id===object.id){sp33CropSession=null;cropMode=false;$('#app').classList.remove('sp33-crop-active');}
      spBridgeFinishPictureChange(context);
      toast('已更换图片，原位置、尺寸、裁剪及样式均保留');
    }catch(error){toast('更换图片失败：'+error.message,true);}
    finally{$('#replace-picture-upload').value='';}
  }
