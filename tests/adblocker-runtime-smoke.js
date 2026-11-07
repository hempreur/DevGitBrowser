'use strict';
// Runs after npm install on the Windows builder, not as a stubbed unit test.
const assert=require('node:assert/strict');
const {ElectronBlocker}=require('@ghostery/adblocker-electron');
const {OFFLINE_FILTERS}=require('../lib/adblocker');
assert.equal(typeof ElectronBlocker.parse,'function');
assert.equal(typeof ElectronBlocker.fromLists,'function');
const blocker=ElectronBlocker.parse(OFFLINE_FILTERS,{loadNetworkFilters:true,loadCosmeticFilters:true});
const serial=blocker.serialize();
assert.ok(serial.byteLength>0);
const restored=ElectronBlocker.deserialize(serial);
assert.ok(restored);
console.log('DevGitShield real Electron filter engine parsed and restored successfully.');
