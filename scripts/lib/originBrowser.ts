import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {AiDraftBlockNode,reviewAiBlock} from '../../src/components/manuscriptEditor/AiDraftBlockNode';
import {markerStringToTiptapDoc,tiptapDocToMarkerString,markerOffsetToDocPos} from '../../src/utils/manuscriptDoc';
import {aiTextFragments} from '../../shared/aiTextOrigin';
export function originEditorProbe(){
 const checks:string[]=[];const ok=(name:string,b:unknown)=>{if(!b)throw new Error(name);checks.push(name);};
 const root=document.createElement('div');document.body.append(root);
 const e=new Editor({element:root,extensions:[StarterKit,AiDraftBlockNode],content:markerStringToTiptapDoc('[AI-DRAFT]\n\nПерша фраза. Друга фраза.\n\n[/AI-DRAFT]')});
 const text=()=>tiptapDocToMarkerString(e.getJSON());
 e.commands.setTextSelection({from:2,to:14});
 ok('accept selection succeeds',reviewAiBlock(e,0,'writer',true));
 const split=aiTextFragments(text());
 ok('partial acceptance keeps a separate unaccepted remainder',split.length===2&&split[0].status==='accepted'&&split[1].status==='draft');
 const id=split[0].origin!.id;
 e.commands.setTextSelection(3);e.commands.insertContent('Автор: ');
 ok('typing retains accepted origin',aiTextFragments(text())[0].origin?.id===id);
 e.commands.undo();e.commands.undo();
 ok('undo restores original draft without accepted metadata',!text().includes('AI-GENERATED')&&text().includes('Перша фраза.'));
 e.commands.redo();ok('redo restores same fragment ID',aiTextFragments(text())[0].origin?.id===id);
 const node=e.state.doc.firstChild!;e.commands.insertContentAt(e.state.doc.content.size,node.toJSON());
 const ids=aiTextFragments(text()).filter(f=>f.origin).map(f=>f.origin!.id);
 ok('copying accepted block gives unique ID and preserves provenance',ids.length===2&&new Set(ids).size===2);
 const html=e.getHTML();
 e.commands.setContent('<p>Тимчасово.</p>');e.commands.setContent(html);
 ok('clipboard HTML roundtrip retains AI origins',aiTextFragments(text()).filter(f=>f.origin).length===2);
 const acceptedPos:number[]=[];e.state.doc.descendants((n,pos)=>{if(n.type.name==='aiDraft'&&n.attrs.provenance)acceptedPos.push(pos);});
 const pos=acceptedPos.at(-1)!,copied=e.state.doc.nodeAt(pos)!;
 e.view.dispatch(e.state.tr.delete(pos+1,pos+copied.nodeSize-1));
 ok('deleting accepted contents removes empty origin wrapper',aiTextFragments(text()).filter(f=>f.origin).length===1);
 const saved=text();e.commands.setContent(markerStringToTiptapDoc(saved));
 ok('reload retains origin and draft separately',text().trim()===saved.trim());

 const finalText=text(),hit=finalText.indexOf('Друга');
 if(hit>=0){const at=markerOffsetToDocPos(e.state.doc,hit);ok('tag navigation maps exact source position to editor text',at!=null&&e.state.doc.textBetween(at!,at!+5)==='Друга');}
 e.destroy();root.remove();return checks;
}
