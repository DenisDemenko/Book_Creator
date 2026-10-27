import assert from 'node:assert/strict';
import { fundingRouteAllowed } from '../server/fundingBridge';
for (const [method,path] of [['GET','/'],['PUT','/settings'],['GET','/campaigns/abc-123/recipient'],['POST','/campaigns/abc/review'],['POST','/campaigns/abc/bank-facts'],['POST','/campaigns/abc/payouts/def'],['POST','/campaigns/abc/reports/def'],['POST','/campaigns/abc/refunds/def']]) assert.equal(fundingRouteAllowed(method,path),true);
for (const [method,path] of [['DELETE','/campaigns/abc'],['GET','//example.com'],['POST','/../payments/dev/confirm'],['POST','/campaigns/abc/contributions'],['GET','/settings'],['POST','/campaigns/a/reports/b/../../review']]) assert.equal(fundingRouteAllowed(method,path),false);
console.log('PASS: Studio funding bridge forwards only authorized administrative route shapes.');
