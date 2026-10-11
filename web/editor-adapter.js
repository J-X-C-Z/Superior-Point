/** The final editor is intentionally NOT bundled until the user supplies it. */
import {renderSlideSVG} from '../io/html.js';
let registered=null;
export function registerEditorAdapter(adapter){if(!adapter||typeof adapter.mount!=='function')throw new TypeError('Editor adapter needs mount(context)');registered=adapter;}
export function getEditorAdapter(){return registered;}
export function mountEditor(context){
 const adapter=registered;
 if(adapter)return adapter.mount(context);
 const {container}=context;
 const render=document=>{container.replaceChildren();const note=Object.assign(window.document.createElement('div'),{className:'preview-note',textContent:'基础预览 · 正式编辑器待接入。这里可检查项目结构与导出结果；不代表最终编辑或动画效果。'});container.append(note);const grid=window.document.createElement('div');grid.className='preview-grid';container.append(grid);document.slides.forEach((slide,i)=>{const figure=window.document.createElement('figure');figure.className='slide-preview';try{figure.innerHTML=renderSlideSVG(document,slide.id);}catch(error){const issue=window.document.createElement('p');issue.textContent='预览不可用：'+error.message;issue.style.padding='20px';figure.append(issue);}const label=window.document.createElement('figcaption');label.textContent=`${String(i+1).padStart(2,'0')} / ${slide.id} · ${(slide.elements||[]).length} elements`;figure.append(label);grid.append(figure);});if(!document.slides.length){const empty=window.document.createElement('p');empty.textContent='空白项目已建立，等待编辑器接入。';grid.append(empty);}};
 render(context.document);return {update:render,destroy(){container.replaceChildren();}};
}
