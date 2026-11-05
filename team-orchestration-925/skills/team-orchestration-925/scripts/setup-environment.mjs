// These parser/discovery subprocesses are not hosted team agents. Keep their
// disposable configuration home, without advertising the parent's native actor.
export function configurationEnvironment(home,source=process.env){
 const env=Object.fromEntries(Object.entries(source).filter(([key])=>!/^ORCA_|^CODEX_(THREAD|SESSION)_ID$|^TEAM_(PROJECT_ROOT|TERMINAL_HANDLE|CONTEXT_ID)$/i.test(key)));
 return {...env,CODEX_HOME:home};
}
