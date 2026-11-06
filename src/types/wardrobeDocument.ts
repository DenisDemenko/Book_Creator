export interface WardrobeTextBlock {
  id:string;text:string;x:number;y:number;size:number;maxWidth:number;color:number[];
  role?:string;links?:{label:string;pageId:string}[];
}
export interface WardrobePdfData {
  schema:'fusionlab.wardrobe.pdf';version:1;title:string;createdAt:string;
  backgroundPdf:string;font:string;pages:{id:string;title:string;blocks:WardrobeTextBlock[]}[];
  pageOrder:string[];edits:Record<string,{text:string;size?:number}>;notes:Record<string,string>;
}
export interface WardrobeBookDocument {
  version:1;requestId:string;sourceHash:string;design:Record<string,unknown>;
  document:WardrobePdfData;originalPdf:string;renderedPdf?:string;renderedPageCount?:number;cloudRevision?:number;dirty?:boolean;
}
