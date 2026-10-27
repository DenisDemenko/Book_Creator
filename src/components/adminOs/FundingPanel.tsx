import { FundingAdmin } from './crowdfunding/funding-admin';
import type { FundingRequest } from './crowdfunding/funding-types';
const request: FundingRequest = async (path, method='GET', body) => {
  const response = await fetch(`/api/admin/crowdfunding${path}`, {
    method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || 'Не вдалося отримати фінансові дані.');
  return data;
};
export function FundingPanel() { return <FundingAdmin request={request} theme="studio"/>; }
