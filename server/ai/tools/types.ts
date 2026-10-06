import type {CoreRepository,CoreActor,SimulationRow} from '../../core/types';
import type {SnapshotResult,SnapshotRequest} from '../../core/characterSnapshot';
import type {RuntimeScope} from '../adapters/harness';
export interface BookToolScope extends RuntimeScope {sceneId:string}
export interface BookToolDeps {
 repo:CoreRepository;
 /** Server grant, resolved from the authenticated principal. Never model arguments. */
 scope:BookToolScope;
 authorize:(scope:Readonly<BookToolScope>)=>Promise<boolean>;
 allowedActions:readonly string[];
 situation:string;
 studio?:SnapshotRequest['studio'];
 evaluate?:(actions:readonly string[],signal:AbortSignal)=>Promise<{action:string;awaitingAuthor?:boolean;source?:unknown;decisionId?:unknown}>;
}
export interface ToolSession {
 deps:BookToolDeps;
 scope:Readonly<BookToolScope>;
 simulation:SimulationRow;
 signal:AbortSignal;
 actor:CoreActor;
 snapshot:()=>Promise<SnapshotResult>;
 observed:()=>Promise<Record<string,unknown>[]>;
 args:Record<string,unknown>;
}
export type BookToolHandler=(session:ToolSession)=>Promise<unknown>;
