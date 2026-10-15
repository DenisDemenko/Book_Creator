/** Bounded, public HTTPS retrieval. DNS is checked and pinned for every redirect. */
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { XMLParser } from 'fast-xml-parser';

const privateV4=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)privateV4.addSubnet(ip,bits,'ipv4');
const globalV6=new BlockList();globalV6.addSubnet('2000::',3,'ipv6');
const privateV6=new BlockList();
for(const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const)privateV6.addSubnet(ip,bits,'ipv6');
export function isPublicAddress(address:string):boolean {
  const family=isIP(address);
  return family===4?!privateV4.check(address,'ipv4'):family===6&&globalV6.check(address,'ipv6')&&!privateV6.check(address,'ipv6');
}
export function technicalUrl(raw:string):URL {
  if(typeof raw!=='string'||raw.length>3000)throw new Error('Адреса надто довга.');
  let url:URL;
  try { url=new URL(raw); } catch { throw new Error('Потрібне повне HTTPS-посилання.'); }
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||
      isIP(url.hostname.replace(/^\[|\]$/g,''))||!url.hostname.includes('.')||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname))throw new Error('Потрібна публічна HTTPS-адреса технічного ресурсу.');
  url.hash='';return url;
}
export interface TechnicalResponse { url:string;mimeType:string;bytes:Buffer }
export type TechnicalFetcher=(raw:string)=>Promise<TechnicalResponse>;
export async function fetchTechnicalResource(raw:string, redirects=0):Promise<TechnicalResponse> {
  const url=technicalUrl(raw);
  let dnsTimer:ReturnType<typeof setTimeout>;
  const addresses=await Promise.race([
    lookup(url.hostname,{all:true,verbatim:true}),
    new Promise<never>((_resolve,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('DNS ресурсу не відповів вчасно.')),5000);}),
  ]).finally(()=>clearTimeout(dnsTimer));
  if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new Error('Ця адреса недоступна для імпорту.');
  const selected=addresses[0];
  const response=await new Promise<{status:number;headers:Record<string,any>;bytes:Buffer}>((resolve,reject)=>{
    const req=https.request(url,{
      method:'GET',
      headers:{'User-Agent':'FusionLab-TechnicalImporter/1.0','Accept':'text/html,text/plain,application/pdf,application/rss+xml','Accept-Encoding':'identity'},
      lookup:((_hostname:any,options:any,callback:any)=>{
        if(options?.all)callback(null,[selected]);else callback(null,selected.address,selected.family);
      }) as any,
    },res=>{
      const chunks:Buffer[]=[];let size=0;
      res.on('data',(chunk:Buffer)=>{
        size+=chunk.length;
        if(size>8*1024*1024){req.destroy(new Error('Джерело перевищує 8 МБ.'));return;}
        chunks.push(chunk);
      });
      res.on('end',()=>resolve({status:res.statusCode??500,headers:res.headers,bytes:Buffer.concat(chunks)}));
      res.on('error',reject);
    });
    const timer=setTimeout(()=>req.destroy(new Error('Ресурс не відповів вчасно.')),12000);
    req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end();
  });
  if([301,302,303,307,308].includes(response.status)){
    if(redirects>=3||!response.headers.location)throw new Error('Забагато перенаправлень.');
    return fetchTechnicalResource(new URL(response.headers.location,url).href,redirects+1);
  }
  if(response.status<200||response.status>=300)throw new Error('Ресурс повернув помилку '+response.status+'. Можна імпортувати файл вручну.');
  if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')throw new Error('Стиснений ресурс не підтримує прямий імпорт. Завантажте файл вручну.');
  return {url:url.href,mimeType:String(response.headers['content-type']??'').split(';')[0].toLowerCase(),bytes:response.bytes};
}
function entities(text:string):string {
  return text.replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';})
    .replace(/&nbsp;/gi,' ').replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&amp;/gi,'&');
}
export function technicalHtmlText(html:string):{title:string;text:string} {
  const title=entities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??'Технічний ресурс').replace(/<[^>]*>/g,'').trim();
  let content=html.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1]??html;
  content=content.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|svg|nav|header|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section)>|<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ');
  return {title:title.slice(0,200),text:entities(content).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n\n').trim()};
}
export async function importTechnicalUrl(raw:string,fetcher:TechnicalFetcher=fetchTechnicalResource){
  const response=await fetcher(technicalUrl(raw).href);
  if(response.mimeType==='application/pdf'){
    return {file:{name:'documentation.pdf',type:'application/pdf',dataBase64:response.bytes.toString('base64')},url:response.url,retrievedAt:new Date().toISOString()};
  }
  if(!['text/html','text/plain','application/xhtml+xml'].includes(response.mimeType))throw new Error('Імпорт підтримує HTML, текст і PDF. Інші файли завантажте вручну.');
  const result=response.mimeType==='text/plain'?{title:new URL(response.url).hostname,text:response.bytes.toString('utf8')}:technicalHtmlText(response.bytes.toString('utf8'));
  if(!result.text.trim())throw new Error('Сторінка не містить доступного тексту. Додайте файл або витяг вручну.');
  if(result.text.length>100000)throw new Error('Документ перевищує 100 000 символів. Виберіть потрібний фрагмент або завантажте його файлом.');
  return {source:{...result,kind:'url' as const,approved:false,url:response.url,retrievedAt:new Date().toISOString()}};
}
export async function searchTechnicalResources(query:string,domain?:string,fetcher:TechnicalFetcher=fetchTechnicalResource){
  const q=query.trim();
  if(q.length<3||q.length>400)throw new Error('Запит має містити від 3 до 400 символів.');
  let scope='';
  if(domain?.trim()){const url=technicalUrl('https://'+domain.trim().replace(/^https?:\/\//,''));scope=' site:'+url.hostname;}
  const url='https://www.bing.com/search?format=rss&q='+encodeURIComponent(q+' manual documentation datasheet'+scope);
  const response=await fetcher(url);
  const parsed=new XMLParser({processEntities:false}).parse(response.bytes.toString('utf8'));
  const items=parsed?.rss?.channel?.item;
  if(!items) return [];
  return (Array.isArray(items)?items:[items]).slice(0,8).flatMap((item:any)=>{
    try { const link=technicalUrl(String(item.link));return [{title:String(item.title??link.hostname).slice(0,200),url:link.href,snippet:technicalHtmlText(String(item.description??'')).text.slice(0,500)}]; } catch { return []; }
  });
}
