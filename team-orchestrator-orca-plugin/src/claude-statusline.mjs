import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { readSmallFile, statuslineSample, saveStatuslineSample, claudeBindingFile } from './local/claude-context.mjs';

// Installed as a standalone bundle. The saved original command receives the
// original stdin bytes, cwd, stdout and stderr, even when observation fails.
async function main() {
  const config=JSON.parse((await readSmallFile(process.argv[2],1024*1024)).text);
  if(config.schema!==1)throw Error('Unsupported statusline bridge configuration.');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const command=config.originalStatusLine?.command;
  const child=command?spawn('/bin/sh',['-c',command],{env,stdio:['pipe','inherit','inherit']}):null;
  const completion=child?new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1));child.stdin.on('error',()=>{});}):Promise.resolve(0);
  const chunks=[];let bytes=0;
  for await(const chunk of process.stdin){child?.stdin.write(chunk);bytes+=chunk.length;if(bytes<=1024*1024)chunks.push(chunk);}
  child?.stdin.end();
  if(config.enabled&&!process.env.CLAUDE_JOB_DIR&&bytes<=1024*1024){
    try{
      const sample=statuslineSample(JSON.parse(Buffer.concat(chunks).toString('utf8')),process.env.ORCA_PANE_KEY);
      if(sample){
        const binding=JSON.parse((await readSmallFile(claudeBindingFile(config.directory,sample.paneKey))).text);
        if(binding.paneKey===sample.paneKey&&binding.sessionId===sample.sessionId&&binding.path===sample.path){
          const file=await stat(sample.path);if(file.isFile()){sample.binding=binding;sample.transcriptFile={dev:file.dev,ino:file.ino};await saveStatuslineSample(config.directory,sample);}
        }
      }
    }catch{/* Observation must never break the user's status line. */}
  }
  process.exitCode=await completion;
}
main().catch(()=>{process.exitCode=1;});
