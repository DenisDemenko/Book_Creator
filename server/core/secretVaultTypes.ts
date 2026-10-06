export type SecretKind='personal_secret'|'false_belief'|'world_secret';
export interface VaultCipher {iv:string;tag:string;data:string}
export interface SecretVersion {version:number;commitment:string;cipher:VaultCipher;createdAt:string}
export interface VaultSecret {id:string;kind:SecretKind;characterId:string|null;originSimulationId:string;createdSceneId:string;hiddenFromAuthor:boolean;used:boolean;frozen:boolean;status:'sealed'|'revealed'|'archived';revealedSceneId?:string;authorRevealed?:boolean;versions:SecretVersion[];createdAt:string}
export interface VaultAudit {seq:number;secretId:string;action:'create'|'regenerate'|'first_use'|'freeze'|'emergency_reveal'|'reveal'|'director'|'archive';actor:string;at:string;previousHash:string;hash:string;version:number}
export interface SecretVaultState {revision:number;secrets:VaultSecret[];audit:VaultAudit[];plans?:{secretId:string;cipher:VaultCipher}[]}
export interface RevealPolicy {notBeforeSceneId:string;requiredEventIds:string[];allowedCharacterIds:string[];claims:{entityId:string;label:string;value:string}[]}
export interface SecretPayload {text:string;bounds:string;salt:string;policy:RevealPolicy;director?:{hints:string[];evidenceIds:string[]}}
