export interface MagicEvent {id:string;turn:number;characterId:string;characterName:string;action:string;speech:string;actionText:string;audience:string[];at:string}
export interface MagicFragment {id:string;text:string;eventIds:string[];tags:{id:string;value:string}[];status:'draft'|'applying'|'accepted'|'rejected';branchId?:string;branchFragmentId?:string;selectedTagIds?:string[];acceptedRevision?:number}
export interface MagicSceneRun {
 revision:number;simulationId:string;sceneId:string;participants:string[];goal:string;constraints:string;maxTurns:number;asOfChapter:number|null;sourceHash:string;bookSceneHash:string;canonHash:string;sourceText:string;
 status:'active'|'paused'|'closed';busy:{token:string;kind:'step'|'draft'|'approve';at:string}|null;
 events:MagicEvent[];privateSteps:{eventId:string;characterId:string;thought:string;intent:string;decision:Record<string,unknown>;toolTrace?:readonly import('../ai/adapters/harness').TraceEvent[];snapshotHash:string}[];
 fragments:MagicFragment[];requests:{id:string;operation:string}[];lastError?:string;createdAt:string;
}
