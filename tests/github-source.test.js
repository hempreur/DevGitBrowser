'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GitHubAPI, cleanRepoName, cleanBranch, groupExtensions, revision, extensionPath, verifyPrivateOwnedRepo } = require('../lib/github-source');
const crypto = require('node:crypto');
function sha(s){const body=Buffer.from(s);return crypto.createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');}
test('Rejects fake GitHub repo names and branch path attacks',()=>{
  for(const repo of ['../admin','evil/repo','.',''])assert.throws(()=>cleanRepoName(repo));
  for(const branch of ['../main','dev//test','dev@{x}',''])assert.throws(()=>cleanBranch(branch));
  assert.equal(cleanBranch('feature/my-extension'),'feature/my-extension');
  assert.equal(cleanRepoName('mes_extensions'),'mes_extensions');
});
test('Only private repos owned by the authenticated user are trusted',()=>{
  const user={id:123,login:'Alice'};
  assert.deepEqual(verifyPrivateOwnedRepo(user,{id:55,name:'plug-ins',private:true,owner:{id:123},permissions:{pull:true}}),
    {owner:'Alice',ownerId:123,repo:'plug-ins',repoId:55});
  assert.throws(()=>verifyPrivateOwnedRepo(user,{id:55,name:'plug-ins',private:false,owner:{id:123},permissions:{pull:true}}),/PRIVÉ/);
  assert.throws(()=>verifyPrivateOwnedRepo(user,{id:55,name:'plug-ins',private:true,owner:{id:999},permissions:{pull:true}}),/PRIVÉ/);
});
test('Only extension folder blobs are loaded; symlinks and traversal skipped',()=>{
  const manifest='{"manifest_version":3,"name":"Test","version":"1.0"}';
  const entries=[
    {type:'blob',mode:'100644',path:'extensions/trusted/manifest.json',sha:sha(manifest),size:Buffer.byteLength(manifest)},
    {type:'blob',mode:'100644',path:'extensions/trusted/sub/content.js',sha:sha('hello'),size:5},
    {type:'blob',mode:'120000',path:'extensions/trusted/secret',sha:sha('hello'),size:5},
    {type:'blob',mode:'100644',path:'extensions/trusted/../../steal',sha:sha('hello'),size:5},
    {type:'blob',mode:'100644',path:'data/other-plugin/manifest.json',sha:sha(manifest),size:Buffer.byteLength(manifest)}
  ];
  const result=groupExtensions({tree:entries,truncated:false});
  assert.equal(result.size,1);assert.equal(result.get('trusted').length,2);
  assert.equal(revision(result.get('trusted')).length,24);
  assert.throws(()=>extensionPath('/safe/extensions','trusted','123','../../pwn'));
});
test('Rejects truncated tree and overlarge blobs',()=>{
  assert.throws(()=>groupExtensions({tree:[],truncated:true}));
  assert.throws(()=>groupExtensions({tree:[{type:'blob',mode:'100644',path:'extensions/a/manifest.json',sha:'1'.repeat(40),size:2_000_000}],truncated:false}),/trop grand/);
});
test('GitHub blobs are checked against their object hash',async()=>{
  const contents=Buffer.from('console.log("ok")');
  const digest=sha(contents);
  const mock=async()=>({encoding:'base64',content:contents.toString('base64'),size:contents.length});
  const api=new GitHubAPI('github_pat_example',mock);
  assert.deepEqual(await api.blob('test','private',digest),contents);
  await assert.rejects(api.blob('test','private','0'.repeat(40)),/Empreinte/);
});
