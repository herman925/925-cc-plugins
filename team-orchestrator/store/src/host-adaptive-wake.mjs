import {homedir} from 'node:os';
import {join} from 'node:path';
import {createOrcaWake,FENCED_WAKE_CAPABILITY} from './orca-wake.mjs';
import {createWakeRouter} from './wake-routing.mjs';
export function createHostAdaptiveWake({host,journalRoot=join(homedir(),'.team-orchestrator','wake-receipts'),checkEligible,managedBackend,...options}){
 const primary={id:'orca-terminal',availability:async()=>host.capabilities?.includes(FENCED_WAKE_CAPABILITY)&&host.capabilities?.includes('terminal.prompt-delivery.v1')&&host.promptJournalId?{state:'available'}:{state:'unavailable',reason:'missing-target-fence'},wake:createOrcaWake({host,journalRoot,checkEligible,...options})};
 return createWakeRouter({primary,fallback:managedBackend,journalRoot,checkEligible,...options});
}
