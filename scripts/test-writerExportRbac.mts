import assert from 'node:assert/strict';
import { canAccessTab, getRoleInfo, hasPermission } from '../src/utils/rbac';

const writer = getRoleInfo('writer');

assert.equal(hasPermission('writer', 'canExport'), true, 'writer must be allowed to export own book files');
assert.equal(canAccessTab('writer', 'export'), true, 'writer must see Export tab');
assert.ok(writer.permissions.allowedTabs.includes('export'), 'writer role config must include export tab');

// Export access must not silently promote the author to an administrator.
assert.equal(hasPermission('writer', 'canManageRoles'), false, 'writer must not manage roles');
assert.equal(hasPermission('writer', 'canManageApiKeys'), false, 'writer must not manage provider keys');
assert.equal(hasPermission('writer', 'canManageSettings'), false, 'writer must not manage system settings');
assert.equal(canAccessTab('writer', 'admin'), false, 'writer must not get admin tab from export permission');

// Existing non-export role boundaries stay unchanged.
assert.equal(hasPermission('reader', 'canExport'), false, 'reader remains non-exporting');
assert.equal(canAccessTab('reader', 'export'), false, 'reader must not see Export tab');
assert.equal(hasPermission('seller', 'canExport'), false, 'seller remains non-exporting');
assert.equal(canAccessTab('seller', 'export'), false, 'seller must not see Export tab');

console.log('Writer export RBAC contract: OK');
