// Diagnostics are observations, never identity evidence. Return only bounded
// categories and exit status: subprocess text can contain private runtime data.
export function nativeCliFailure(result:any,error?:unknown):string {
 let text=''
 try{text=[(error as any)?.code,(error as any)?.name,(error as any)?.message,result?.stderr,result?.stdout].filter(v=>typeof v==='string').join(' ').slice(0,8192)}catch{}
 const category=/\b(?:EACCES|EPERM|runtime_access_denied)\b|permission denied|access (?:is )?denied/i.test(text)?'access-denied'
  :/\b(?:ENOENT|ENOTDIR)\b|not recognized|executable.*not found|command not found/i.test(text)?'executable-unavailable'
  :/\b(?:ETIMEDOUT|TimeoutError)\b|timed?\s*out|timeout/i.test(text)?'timeout'
  :'subprocess-failed'
 const exit=Number.isSafeInteger(result?.exitCode)?`; exit ${result.exitCode}`:''
 return `guard probe ${category}${exit}`
}
