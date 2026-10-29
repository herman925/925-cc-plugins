import assert from 'node:assert/strict';
import {transform} from 'esbuild';
import {ensureDispatchDepth} from '../src/local/dispatch-depth.mjs';

export async function verifyDepthSettingsContract(source) {
  assert.match(source,/ipcMain\.handle\('settings:get', \(\) => \{\s*return readSettingsWithRuntimeEnvironmentPreference/);
  assert.match(source,/window\.webContents\.send\('settings:changed', updates\)/);
  const sanitizer=source.match(/function sanitizeRendererSettingsUpdate\([\s\S]*?\n\}/)?.[0];
  const appearance=source.match(/const APPEARANCE_MENU_KEYS:[\s\S]*?\n\]/)?.[0];
  const setter=source.match(/ipcMain\.handle\('settings:set', async \(event, args: Partial<GlobalSettings>\) => \{([\s\S]*?)\n  \}\)/)?.[1];
  assert.ok(sanitizer);assert.ok(appearance);assert.ok(setter);
  const compiled=await transform(`${sanitizer}\n${appearance}\nasync function write(event,args:Partial<GlobalSettings>){${setter}\n}`,{loader:'ts',target:'node22'});
  // Execute the pinned setter body unchanged. Only persistence is inert; unrelated
  // branches must stay unexecuted for this exact one-field settings update.
  let settings={nestedWorkerMaxDepth:1,unrelated:'preserved',pluginConsents:{keep:true}},writes=0;
  const store={getSettings:()=>({...settings}),updateSettings:(args,options)=>{assert.deepEqual(args,{nestedWorkerMaxDepth:2});assert.equal(options.originWebContentsId,77);writes++;settings={...settings,...args};return {...settings};}};
  const nativeWrite=new Function('store','SETTINGS_CHANGED_WHITELIST_SET',compiled.code+';return write;')(store,new Set());
  const event={sender:{id:77}};
  let authorityChecks=0;
  const result=await ensureDispatchDepth({requiredDepth:2,scope:{executionHostId:'local'}},{authority:async()=>{authorityChecks++;},getSettings:()=>store.getSettings(),setSettings:args=>{
    const pending=nativeWrite(event,args);
    assert.equal(settings.nestedWorkerMaxDepth,2,'the exact native depth update must happen synchronously before yielding');
    return pending;
  }});
  assert.equal(result.observedDepth,2);assert.equal(writes,1);assert.equal(authorityChecks,2);assert.equal(settings.unrelated,'preserved');assert.deepEqual(settings.pluginConsents,{keep:true});
  settings.nestedWorkerMaxDepth=5;
  assert.equal((await ensureDispatchDepth({requiredDepth:2,scope:{executionHostId:'local'}},{authority:async()=>{},getSettings:()=>store.getSettings(),setSettings:args=>nativeWrite(event,args)})).observedDepth,5);
  assert.equal(writes,1);
  console.log('PASS: pinned native settings getter and exact one-field setter preserve unrelated settings, update before yielding, verify depth 2 and retain higher limits (inert persistence).');
}
