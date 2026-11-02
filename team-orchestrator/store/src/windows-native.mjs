import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {refusal} from './errors.mjs';
const execute=promisify(execFile);
const shell=()=>join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
function windows(){if(process.platform!=='win32')throw refusal('API_NATIVE_UNVERIFIED','Native process/thread ownership has not been verified on this operating system.');}
export async function inspectWindowsProcess(pid){
 windows();if(!Number.isSafeInteger(pid)||pid<1)throw refusal('API_NATIVE_UNVERIFIED','Invalid native process id.');
 // Win32_Process.CreationDate loses sub-microsecond precision. Get-Process
 // preserves the FILETIME ticks returned by Restart Manager; never round them.
 const script=`$p=Get-Process -Id ${pid} -ErrorAction Stop; [pscustomobject]@{pid=[int]$p.Id;executable=[string]$p.Path;createdAt=$p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()}|ConvertTo-Json -Compress`;
 const {stdout}=await execute(shell(),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:5000,maxBuffer:8192});return JSON.parse(stdout);
}
export async function windowsFileOwners(path){
 windows();
 const {stdout}=await execute(shell(),['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./windows-thread-owner.ps1',import.meta.url)),'-LiteralPath',path],{windowsHide:true,timeout:8000,maxBuffer:32768});return JSON.parse(stdout);
}
