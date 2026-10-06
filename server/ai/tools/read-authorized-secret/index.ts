import type {BookToolHandler} from '../types';
import {ToolDeniedError} from '../../adapters/harness';
import {readCharacterSecret} from '../../../core/secretVault';
export const readAuthorizedSecret:BookToolHandler=async s=>{if(!s.deps.vaultKey||typeof s.args.secretId!=='string')throw new ToolDeniedError('Vault або дозвіл секрету недоступні.');return readCharacterSecret(s.deps.repo,s.deps.vaultKey(),s.scope,s.args.secretId);};
