import fs from 'node:fs';
import path from 'node:path';

let cached:{logo:string;background:string}|undefined;
/** Uses public site assets; embeds keep downloaded HTML usable offline. */
export function editionBrand(){
  if(cached)return cached;
  const asset=(prefix:string,source:string,mime:string)=>{
    const dir=path.resolve('dist/assets');
    const built=fs.existsSync(dir)?fs.readdirSync(dir).find(n=>n.startsWith(prefix+'-')&&n.endsWith(path.extname(source))):undefined;
    const file=built?path.join(dir,built):path.resolve(source);
    if(!fs.existsSync(file))return '';
    const data=fs.readFileSync(file);
    if(data.length>1024*1024)throw new Error('Public brand asset exceeds its size limit.');
    return 'data:'+mime+';base64,'+data.toString('base64');
  };
  return cached={logo:asset('fusion-lab-studio-logo','src/assets/fusion-lab-studio-logo.png','image/png'),background:asset('emerald','src/assets/backgrounds/emerald.webp','image/webp')};
}
