import fs from 'node:fs/promises';
import {manuscriptTagIndex,filterTagIndex} from '../src/utils/manuscriptTagIndex';
const [filename,...args]=process.argv.slice(2);
if(!filename){console.error('Usage: npm run tags:scan -- book.json --tags=/location:Вежа,origin:ai --status=accepted');process.exit(2);}
const json=JSON.parse(await fs.readFile(filename,'utf8'));
const options=Object.fromEntries(args.map(arg=>arg.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
const book=json.book??json;
console.log(JSON.stringify(filterTagIndex(manuscriptTagIndex(book),{tags:options.tags?.split(','),status:options.status,chapterId:options.chapterId,sectionId:options.sectionId}),null,2));
