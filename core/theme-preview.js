import {createDocument,importDocument} from './document-core.js';
import {createThemeBindings} from './theme-application.js';
import {verifyThemeAssets,createThemeRef} from './theme-schema.js';

// Original geometric landscape, MIT. Embedded PNG avoids network or SVG execution.
const illustration='iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAACJElEQVR4nO3RwU0DQRBE0c2RCylwJAbEnQgIiAtJEAIBcLBkWWDZ7GzPVE3Nl34A3fW2768PCm6TX0BdAzg8gMMDODyAwwM4PIDDAzg8gMMDODyAwwO4ss/Xh9uNPwngmu7SqpgBPtou2vHMAB+qWXeYMcCNHaQdxgxwYwAnV6jb2xjg3ZXrdjUGeHcAJ9dJt58xwADTEN1OxgADTAAv0kTAb+8vpwDOAT6jXgbw3MBXUQGeG/guKsDzAe9CBXgO4GZUgH2BS1AB9gIuRwVYb9wVFWAN8DBUgMcZS1AB7gssRwW43lgOCXC9sRwP4PrkYACDCnA6KsDhqACHo64OLB8dYFABBnVNYPmgbiUAy0d0blZg+XDmPT4/nZoJWL6aeWfUy9yB5auZdxXVHVi+mnl3UR2B5auZtwvVBVi+mnnNqEpg+WrmlaCOBpavZl456ghg+WrmdUXtBSxfzbxhqJXA8tXMk6AeBZavZp4ctQVYvpp5csgWYPlq5snxWoDlq5knB2sBlq9mnhzpELB8Ps/kMACDCvCqqKsDy0cHGFSAQV0TWD6oWwnA8hGdmxVYPtwszQQsH2vG3IHlA82eI7B8lKRcgOVDpKYElj+/QqOB5Q+v1ghg+ZMr1wtY/hidqgSWP0N/Owosf4Bu1wIsP5r+33+B5YdSW7eA5cfR8X4Dyw+i2jZQs9vkF1DXAA4P4PAADg/g8AAOD+DwAA4P4PAADu8HLOSaMBl0psQAAAAASUVORK5CYII=';
export async function createThemePreviewDocument(input,{ratio='16:9'}={}){
 const theme=await verifyThemeAssets(input);
 if(!theme.supportedRatios.includes(ratio))throw new Error('主题不支持画布比例：'+ratio);
 const width=ratio==='4:3'?960:1280,height=720,doc=createDocument({title:theme.name+' · 四页样例',canvas:{width,height}}),{colors,typography,spacing,components}=theme.tokens;
 let inset=0,gap=0,inner=0;const panel=components.panel??{};
 let current='',counter=0;
 const id=()=>`${current}-${++counter}`;
 const text=(value,x,y,w,h,role='body')=>{const type=typography[role]||typography.body||{fontFamily:'Arial',fontSize:24,fontWeight:400,lineHeight:1.25};return {id:id(),type:'text',text:value,x,y,w,h,fontFamily:type.fontFamily,fontSize:type.fontSize,fontWeight:type.fontWeight,bold:type.fontWeight>=700,color:role==='caption'?(colors.muted||colors.text):colors.text,lineHeight:type.lineHeight??1.25,themeRole:role};};
 const shape=(x,y,w,h,role='panel',kind='rect')=>({id:id(),type:'shape',shape:kind,x,y,w,h,fill:role==='accent'?colors.accent:(colors.surface||colors.background),stroke:role==='accent'?colors.accent:(colors.muted||colors.text),strokeWidth:panel.strokeWidth??0,radius:panel.radius??0,themeRole:role});
 const slide=(kind,title)=>{current=kind;counter=0;const rules=theme.layouts.find(layout=>layout.kind===kind)?.rules||{};inset=Math.min(rules.pageInset??spacing.pageInset??64,width/6);inner=width-inset*2;gap=Math.min(rules.gap??spacing.gap??24,inner*.12);const result={id:'preview-'+kind,title,background:colors.background,themeLayout:kind,elements:[],animations:[],notes:'原创演示内容；数值与图像不来自用户项目。'};doc.slides.push(result);return result.elements;};
 const motif=theme.layouts.find(layout=>layout.kind==='cover')?.rules.motif||components.accent?.motif||'rule';
 const cover=slide('cover','标题页');
 if(motif==='index')cover.push(shape(inset,inset,inner,12,'accent'),text('01',inset,150,inner,100,'title'));
 else if(motif==='band')cover.push(shape(0,0,width,20,'accent'),shape(inset,inset,inner,height-inset*2));
 else if(motif==='frame')cover.push(shape(inset,inset,inner,height-inset*2),shape(inset,inset,inner,4,'accent'));
 else if(motif==='circle')cover.push(shape(width-inset-210,135,210,210,'accent','ellipse'));
 else if(motif==='orbit'){const ring=shape(width-inset-220,115,220,220,'accent','ellipse');ring.fill=colors.surface||colors.background;cover.push(ring,shape(width-inset-170,165,120,120,'accent','ellipse'));}
 else cover.push(shape(inset,160,8,350,'accent'));
 const coverX=motif==='rule'?inset+32:inset+(motif==='band'||motif==='frame'?gap:0),coverWidth=width-coverX-inset;
 cover.push(text('SUPERIOR POINT / '+ratio,coverX,inset+28,coverWidth,40,'caption'),text(theme.name,coverX,motif==='index'?280:290,coverWidth,120,'title'),text('让内容形成清晰的节奏',coverX,445,coverWidth,60),text('原创主题 / 标题 · 内容 · 数据 · 图像',coverX,550,coverWidth,40,'caption'));
 const content=slide('content','文字内容页');
 content.push(text('从信息到叙事',inset,70,inner,100,'title'),shape(inset,188,inner,4,'accent'));
 const columns=theme.layouts.find(layout=>layout.kind==='content')?.rules.columns===2?2:1,columnWidth=(inner-gap*(columns-1))/columns;
 if(columns===2){content.push(shape(inset,230,columnWidth,320),shape(inset+columnWidth+gap,230,columnWidth,320),text('01 / 结构',inset+20,250,columnWidth-40,50,'caption'),text('先给读者一个方向\n再展开关键证据\n最后留下行动线索',inset+20,320,columnWidth-40,190),text('02 / 节奏',inset+columnWidth+gap+20,250,columnWidth-40,50,'caption'),text('标题建立层级\n留白区分段落\n颜色标记重点',inset+columnWidth+gap+20,320,columnWidth-40,190));}
 else{content.push(shape(inset,235,inner,325),text('清晰，从删去多余的信息开始。',inset+gap,270,inner-gap*2,65),text('01  建立层级：每页只讨论一个核心问题\n02  保留证据：用具体数据支持判断\n03  给出行动：让下一步有明确方向',inset+gap,365,inner-gap*2,160));}
 content.push(text('共同样例内容 / 主题决定层级与阅读密度',inset,620,inner,35,'caption'));
 const data=slide('data','数据图表页');
 data.push(text('把趋势变成判断',inset,70,inner,100,'title'),text('季度完成量 / 演示数据',inset,180,inner,40,'caption'));
 // The existing chart renderer paints dark labels; a light surface keeps them legible in dark themes.
 data.push({...shape(inset,245,inner,345),fill:components.chart?.surface||'#F8FAFC',stroke:'#DCE3EA'}, {id:id(),type:'chart',chartType:'bar',x:inset+gap,y:265,w:inner-gap*2,h:250,values:[24,38,52,76],labels:['Q1','Q2','Q3','Q4'],fill:components.chart?.surface||'#F8FAFC',chartColor:components.chart?.color||colors.accent,color:components.chart?.text||'#20323C',fontSize:18,chartTitle:'季度完成量',themeRole:'chart'},text('24 → 76',inset,615,inner*0.5,55),text('样例值 / 非实时数据',inset+inner*0.5,620,inner*0.5,40,'caption'));
 doc.assets.push({id:'preview-landscape',mimeType:'image/png',license:'MIT',author:'Superior Point',description:'Original geometric landscape, generated for theme preview.',dataUrl:'data:image/png;base64,'+illustration});
 const image=slide('image','图片组合页'),imageWidth=Math.min(inner*0.55,560),imageX=motif==='band'?width-inset-imageWidth:inset,textX=imageX===inset?inset+imageWidth+gap:inset,textWidth=inner-imageWidth-gap;
 image.push(text('图像，也是一种语言',inset,70,inner,100,'title'),shape(imageX,245,imageWidth,340),{id:id(),type:'image',assetId:'preview-landscape',x:imageX+16,y:261,w:imageWidth-32,h:308,fit:'contain'},text('山色与暖光',textX,285,textWidth,70),text('原创几何风景\n无外部加载\n图片与文字独立可编辑',textX,390,textWidth,150,'caption'),shape(textX,565,Math.min(textWidth,100),8,'accent'),text('图像 + 面板 + 标注 / 可编辑组合元素',inset,630,inner,35,'caption'));
 doc.extensions.theme={ref:await createThemeRef(theme),bindings:createThemeBindings(doc)};
 doc.extensions.themePreview={ratio,kinds:['cover','content','data','image'],limitations:[...(theme.preview?.limitations||[]),'Generic chart labels and light chart surface are fixed for legibility; native editor chart styling may differ.']};
 return importDocument(doc);
}
