import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { atomicFile, readSmallFile, claudeContextDirectory } from './claude-context.mjs';

const quote = value => "'"+value.replaceAll("'","'\\''")+"'";
async function optional(path){try{return await readSmallFile(path,1024*1024);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const object = value => value && typeof value==='object' && !Array.isArray(value);

export function createClaudeStatuslineSettings({userData,helperPath,configDir=process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),executable=process.execPath,electron=Boolean(process.versions.electron),platform=process.platform,consent}) {
  const directory=claudeContextDirectory(userData),root=join(configDir,'team-orchestrator-orca'),settingsPath=join(configDir,'settings.json'),configPath=join(root,'bridge.json'),installedHelper=join(root,'statusline.cjs');
  const installedCommand=(electron?'ELECTRON_RUN_AS_NODE=1 ':'')+quote(executable)+' '+quote(installedHelper)+' '+quote(configPath);
  const supported=platform==='darwin'&&isAbsolute(userData||'')&&isAbsolute(helperPath||'');
  const read=async()=>{
    const file=await optional(settingsPath),settings=file?JSON.parse(file.text):{};
    if(!object(settings))throw Error('Claude settings must be a JSON object.');
    const saved=await optional(configPath),config=saved?JSON.parse(saved.text):null;
    if(config&&(config.schema!==1||!object(config)))throw Error('The saved Claude context configuration is unsupported.');
    return {file,settings,config};
  };
  const status=async()=>{
    await consent();
    if(!supported)return {supported:false,enabled:false,detail:'Claude context connection is available on the local Mac.'};
    const {settings,config}=await read();
    const enabled=Boolean(config?.enabled&&settings.statusLine?.command===config.installedCommand&&config.directory===directory);
    return {supported:true,enabled,detail:enabled?'Connected. Claude reports its context when the status line updates.':'Connect Claude context through your user settings. Existing status line output is preserved.'};
  };
  return {status,async configure(enabled){
    await consent();if(!supported)throw Error('Claude context setup is unavailable on this host.');
    if(typeof enabled!=='boolean')throw Error('Choose whether to connect Claude context.');
    await mkdir(root,{recursive:true,mode:0o700});
    const lockPath=join(root,'configuration.lock');let lock;
    try{lock=await open(lockPath,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('Another Claude context configuration is in progress.');throw error;}
    try{
      const {file,settings,config}=await read();
      const ours=config&&settings.statusLine?.command===config.installedCommand;
      if(config?.enabled&&!ours&&JSON.stringify(settings.statusLine??null)!==JSON.stringify(config.originalStatusLine))throw Error('The status line was changed outside this plugin. Keep that configuration; restore or reconnect it explicitly before changing this bridge.');
      if(enabled){
        const originalStatusLine=ours?config.originalStatusLine:settings.statusLine??null;
        if(originalStatusLine!==null&&(!object(originalStatusLine)||originalStatusLine.type!=='command'||typeof originalStatusLine.command!=='string'))throw Error('This status line format cannot be preserved by the bridge.');
        if(!ours&&originalStatusLine?.command.includes('team-orchestrator-orca'))throw Error('Another Claude context bridge already owns this status line.');
        // Stable copy survives moving/updating the plugin checkout. Keep the full
        // original statusLine object so disconnect restores padding and other options.
        const helper=await readFile(helperPath,'utf8');
        await consent();await atomicFile(installedHelper,helper);
        const next={schema:1,enabled:false,directory,installedCommand,originalStatusLine};
        await atomicFile(configPath,JSON.stringify(next,null,2)+'\n');
        settings.statusLine={...(originalStatusLine||{}),type:'command',command:installedCommand};
      }else{
        if(!ours)return status();
        if(config.originalStatusLine===null)delete settings.statusLine;else settings.statusLine=config.originalStatusLine;
      }
      // Never replace a concurrently edited settings file with our earlier snapshot.
      await consent();if((await optional(settingsPath))?.text!==file?.text)throw Error('Claude settings changed during setup. No settings were replaced.');
      await atomicFile(settingsPath,JSON.stringify(settings,null,2)+'\n',file?.stat.mode&0o777||0o600);
      const installed=JSON.parse((await readSmallFile(configPath,1024*1024)).text);
      await atomicFile(configPath,JSON.stringify({...installed,enabled},null,2)+'\n');
      return await status();
    }finally{await lock.close();await unlink(lockPath).catch(()=>{});}
  }};
}
