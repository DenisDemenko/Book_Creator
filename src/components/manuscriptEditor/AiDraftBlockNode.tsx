import { closeHistory } from '@tiptap/pm/history';
import React, { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Fragment } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { acceptAiOrigin, normalizeAiOrigin, type AiTextOrigin } from '../../../shared/aiTextOrigin';

export interface AiDraftBlockOptions {
 label:string; reviewLabel:string; rejectLabel:string; acceptedLabel?:string; reviewer?:()=>string;
}
/** Uses a single transaction: undo restores the exact draft, IDs and selection. */
export function reviewAiBlock(editor:any,pos:number,actor:string,selectionOnly=false) {
 const node=editor.state.doc.nodeAt(pos);if(!editor.isEditable||!node||node.type.name!=='aiDraft'||node.attrs.provenance)return false;
 const origin=acceptAiOrigin(actor);
 let from=0,to=node.content.size;
 if(selectionOnly){from=Math.max(0,editor.state.selection.from-pos-1);to=Math.min(to,editor.state.selection.to-pos-1);if(to<=from)return false;}
 const nodes:any[]=[];
 const add=(a:number,b:number,p:AiTextOrigin|null)=>{
  if(b<=a)return;const content=node.content.cut(a,b);
  if(!content.textBetween(0,content.size).trim()&&!content.toJSON()?.some((n:any)=>n.type!=='paragraph'))return;
  nodes.push(node.type.create({...node.attrs,pid:null,provenance:p},content));
 };
 add(0,from,null);add(from,to,origin);add(to,node.content.size,null);
 editor.view.dispatch(closeHistory(editor.state.tr.replaceWith(pos,pos+node.nodeSize,Fragment.fromArray(nodes))));
 editor.view.dispatch(closeHistory(editor.state.tr));
 return true;
}
const AiDraftBlockView=({node,getPos,editor,extension}:ReactNodeViewProps)=>{
 const options=extension.options as AiDraftBlockOptions;
 const origin=normalizeAiOrigin(node.attrs.provenance);
 const [details,setDetails]=useState(false);
 const accept=(partial=false)=>{const pos=getPos();if(typeof pos==='number')reviewAiBlock(editor,pos,options.reviewer?.()||'local-author',partial);};
 return <NodeViewWrapper as="div" data-ai-draft={origin?undefined:''} data-ai-generated={origin?.id}
  className={'nova-ai-draft'+(origin?' nova-ai-accepted':'')}>
  <div className="nova-ai-draft-label" contentEditable={false}>
   <span>{origin?(options.acceptedLabel||'Згенеровано ШІ · прийнято автором'):('✨ '+options.label)}</span>
   {origin?<button type="button" aria-label="AI metadata" onClick={()=>setDetails(!details)}>ⓘ</button>:<>
    <button type="button" title={options.reviewLabel} aria-label={options.reviewLabel} data-ai-draft-accept disabled={!editor.isEditable}
     onMouseDown={e=>e.preventDefault()} onClick={()=>accept()}>✓</button>
    <button type="button" title="Прийняти виділену частину / Accept selection" data-ai-selection-accept disabled={!editor.isEditable}
     onMouseDown={e=>e.preventDefault()} onClick={()=>accept(true)}>✓ ▤</button>
    <button type="button" title={options.rejectLabel} aria-label={options.rejectLabel} data-ai-draft-reject disabled={!editor.isEditable}
     onMouseDown={e=>e.preventDefault()} onClick={()=>{const pos=getPos();if(typeof pos==='number')editor.view.dispatch(editor.state.tr.delete(pos,pos+node.nodeSize));}}>⊘</button>
   </>}
   {details&&origin&&<small className="break-all">{origin.id} · {origin.acceptedAt} · {origin.acceptedBy}{origin.modelId?' · '+origin.modelId:''}</small>}
  </div>
  <NodeViewContent />
 </NodeViewWrapper>;
};
export const AiDraftBlockNode=Node.create<AiDraftBlockOptions>({
 name:'aiDraft',group:'block',content:'block+',defining:true,isolating:true,
 addOptions(){return {label:'AI-чернетка',reviewLabel:'Прийняти доповнення ШІ',rejectLabel:'Відхилити доповнення ШІ'};},
 addAttributes(){return {provenance:{default:null,
  parseHTML:el=>{try{return normalizeAiOrigin(JSON.parse(el.getAttribute('data-ai-origin')||'null'));}catch{return null;}},
  renderHTML:attrs=>attrs.provenance?{'data-ai-origin':JSON.stringify(normalizeAiOrigin(attrs.provenance))}:{}}};},
 parseHTML(){return [{tag:'div[data-ai-draft]'},{tag:'div[data-ai-origin]'}];},
 renderHTML({HTMLAttributes}){return ['div',mergeAttributes(HTMLAttributes,{'data-ai-draft':''}),0];},
 addNodeView(){return ReactNodeViewRenderer(AiDraftBlockView);},
 addProseMirrorPlugins(){return [new Plugin({
  appendTransaction(transactions,_old,state){
   if(!transactions.some(tr=>tr.docChanged))return null;
   const seen=new Set<string>();const changes:Array<{pos:number;attrs:any;empty:boolean;size:number}>=[];
   state.doc.descendants((n,pos)=>{
    if(n.type.name!=='aiDraft')return;
    const origin=normalizeAiOrigin(n.attrs.provenance);
    const empty=!n.textContent.trim()&&n.childCount===1&&n.firstChild?.type.name==='paragraph';
    if(empty){changes.push({pos,attrs:n.attrs,empty:true,size:n.nodeSize});return false;}
    if(origin){
     if(seen.has(origin.id))changes.push({pos,attrs:{...n.attrs,provenance:{...origin,parentId:origin.parentId||origin.id,id:globalThis.crypto.randomUUID()}},empty:false,size:n.nodeSize});
     seen.add(origin.id);
    }
   });
   if(!changes.length)return null;const tr=state.tr;
   for(const c of changes.reverse())if(c.empty)tr.delete(c.pos,c.pos+c.size);else tr.setNodeMarkup(c.pos,undefined,c.attrs);
   return tr;
  }
 })];}
});
