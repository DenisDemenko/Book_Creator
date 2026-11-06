import {PDFString,rgb} from 'pdf-lib';
export const FUSION_PDF_CREDIT='Документ створено Fusion Lab Studio';
export const FUSION_PDF_URL='https://fusion.in.ua';
// Applied last, outside the editable manifest. The reserved strip prevents an
// enlarged or replaced text block from painting over the mandatory credit.
export function stampFusionPdfHeader(pdf,font){
  for(const page of pdf.getPages()){
    const {width,height}=page.getSize(),size=8,label='fusion.in.ua';
    const x=width-28-font.widthOfTextAtSize(label,size),y=height-13;
    page.drawRectangle({x:0,y:height-21,width,height:21,color:rgb(1,1,1)});
    page.drawText(FUSION_PDF_CREDIT,{x:28,y,size,font,color:rgb(.18,.22,.23)});
    page.drawText(label,{x,y,size,font,color:rgb(.08,.32,.60)});
    page.drawLine({start:{x:28,y:height-20},end:{x:width-28,y:height-20},thickness:.4,color:rgb(.78,.81,.82)});
    page.node.addAnnot(pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,y-2,width-28,y+10],Border:[0,0,0],A:{S:'URI',URI:PDFString.of(FUSION_PDF_URL)}})));
  }
}
