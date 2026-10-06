import type {BookToolHandler} from '../types';
import {ToolDeniedError} from '../../adapters/harness';
/** No plaintext fallback. T4.1 will supply Vault grants and disclosure conditions. */
export const readAuthorizedSecret:BookToolHandler=async()=>{throw new ToolDeniedError('Secret Vault ще не підключений (Т4.1). Доступ до таємниці заборонено.');};
