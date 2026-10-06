import type {BookToolHandler} from '../types';
import {CoreRuleError} from '../../../core/rules';
export const searchCharacterMentions:BookToolHandler=async s=>{
 const query=s.args.query??'';if(typeof query!=='string'||query.length>200)throw new CoreRuleError('bad_input','Запит пошуку — до 200 символів.');
 const snapshot=await s.snapshot();return snapshot.snapshot.recent_appearances.filter(m=>m.excerpt.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(-20);
};
