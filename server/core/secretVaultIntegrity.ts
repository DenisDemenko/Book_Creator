import {createHash} from 'node:crypto';
import type {SecretVaultState} from './secretVaultTypes';
import {CoreRuleError} from './rules';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function checkVaultTransition(old:SecretVaultState,next:SecretVaultState,expected:number){
 const bad=()=>{throw new CoreRuleError('conflict','Незмінність Vault або ревізію порушено.');};
 if(old.revision!==expected||next.revision!==expected+1||next.secrets.length>200||next.audit.length>10000||Buffer.byteLength(JSON.stringify(next))>8*1024*1024||new Set(next.secrets.map(s=>s.id)).size!==next.secrets.length)bad();
 if(!same((next.plans??[]).slice(0,(old.plans??[]).length),old.plans??[]))bad();
 if(next.audit.length!==old.audit.length+1||!same(next.audit.slice(0,old.audit.length),old.audit))bad();
 for(const s of old.secrets){const n=next.secrets.find(x=>x.id===s.id);if(!n||!same([s.id,s.kind,s.characterId,s.originSimulationId,s.createdSceneId,s.hiddenFromAuthor,s.createdAt],[n.id,n.kind,n.characterId,n.originSimulationId,n.createdSceneId,n.hiddenFromAuthor,n.createdAt])||!same(n.versions.slice(0,s.versions.length),s.versions)||s.used&&!n.used||s.frozen&&!n.frozen||(s.used||s.frozen||s.status!=='sealed')&&n.versions.length!==s.versions.length||s.status==='archived'&&n.status!=='archived'||s.status==='revealed'&&n.status==='sealed'||s.revealedSceneId&&n.revealedSceneId!==s.revealedSceneId||s.authorRevealed&&!n.authorRevealed)bad();}
 for(const s of next.secrets)if(!s.versions.length||s.versions.length>20||s.versions.some((v,i)=>v.version!==i+1||!/^[a-f0-9]{64}$/.test(v.commitment)||!v.cipher.iv||!v.cipher.tag||!v.cipher.data))bad();
 const entry=next.audit.at(-1)!;const {hash,...body}=entry;
 if(entry.seq!==next.audit.length||entry.previousHash!==(old.audit.at(-1)?.hash??'')||!next.secrets.some(s=>s.id===entry.secretId)||createHash('sha256').update(JSON.stringify(body)).digest('hex')!==hash)bad();
}
