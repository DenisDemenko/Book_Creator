import type {Express,RequestHandler} from 'express';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {requireAuth} from './auth';
import {getBook,listBooks,saveBook,BookRevisionConflict} from './bookStore';
import {buildStarterBook} from '../src/utils/starterBook';
import {validateEditableDocument,fromBase64} from '../shared/wardrobeDocument.mjs';
export function registerWardrobeDocumentRoutes(app:Express,auth:RequestHandler=requireAuth){
 for(const subject of ['wardrobe','bed'] as const){
  const ID=new RegExp('^'+(subject==='bed'?'BD':'WD')+'-[a-f0-9-]{36}$','i');
  const schema='fusionlab.'+subject+'.pdf';
  app.get('/api/'+subject+'/documents',auth,async(req,res)=>{
    try{const own=await listBooks(req.principal!.id);const docs=[];
      for(const meta of own){const stored=await getBook(meta.id);const d=stored?.book.wardrobeDocument as any;if(d&&(subject==='wardrobe'||d.document?.schema===schema))docs.push({...meta,pageCount:d.renderedPageCount||d.document?.pages?.length||0});}
      res.setHeader('Cache-Control','private, no-store');res.json({documents:docs});
    }catch{res.status(500).json({error:'Не вдалося прочитати документи.'});}
  });
  app.post('/api/'+subject+'/documents',auth,async(req,res)=>{
    try{
      if(req.get(subject==='bed'?'X-Bed-Client':'X-Wardrobe-Client')!=='marketplace-v1')return res.status(403).json({error:'Потрібен запит із конструктора меблів.'});
      const {id,requestId,design,document,originalPdf,expectedRevision}=req.body||{};
      if(!ID.test(id)||!ID.test(requestId)||!design||typeof design!=='object'||JSON.stringify(req.body).length>12000000)throw Error('Некоректний пакет документа.');
      validateEditableDocument(document);
      if(document.schema!==schema)throw Error('Документ не відповідає конструктору.');
      if(typeof originalPdf!=='string'||originalPdf.length>8000000)throw Error('Немає готового PDF.');
      const original=await PDFDocument.load(fromBase64(originalPdf)),background=await PDFDocument.load(fromBase64(document.backgroundPdf));
      if(original.getPageCount()!==document.pages.length||background.getPageCount()!==document.pages.length)throw Error('Сторінки PDF не збігаються з описом.');
      const sourceHash=createHash('sha256').update(JSON.stringify({design,document,originalPdf})).digest('hex');
      const existing=await getBook(id);
      if(existing&&existing.ownerId!==req.principal!.id)return res.status(404).json({error:'Документ не знайдено.'});
      const previous=existing?.book.wardrobeDocument as any;
      if(existing&&(!previous||previous.document?.schema!==schema))return res.status(409).json({error:'Це інша книга. Збережіть документ окремо.'});
      if(previous?.requestId===requestId){if(previous.sourceHash!==sourceHash)return res.status(409).json({error:'Цей запит уже містить інший документ.'});return res.json({id,revision:existing!.revision});}
      const author=req.principal!.name||'Автор',title=document.title.slice(0,200);
      const book=existing?.book||buildStarterBook({bookId:id,title,author,role:req.principal!.role as any});
      const next={...book,title,updatedAt:new Date().toISOString(),wardrobeDocument:{version:1,requestId,sourceHash,design,document,originalPdf,renderedPdf:originalPdf,renderedPageCount:original.getPageCount(),dirty:false}};
      if(JSON.stringify(next).length>12000000)throw Error('Документ завеликий для Книг. Завантажте PDF на пристрій.');
      const saved=await saveBook({book:next,ownerId:req.principal!.id,expectedRevision,mergeKey:`wardrobe:${requestId}:${sourceHash}`,beforeWrite:async()=>{
        const current=await getBook(id);if(current&&current.ownerId!==req.principal!.id)throw Object.assign(Error('Документ не знайдено.'),{status:404});
      }});
      res.json({id:saved.id,revision:saved.revision});
    }catch(e){if(e instanceof BookRevisionConflict)return res.status(409).json({error:e.message,current:e.current});res.status((e as any)?.status===404?404:400).json({error:e instanceof Error?e.message:'Не вдалося зберегти PDF.'});}
  });
 }
}
