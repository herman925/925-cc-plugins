// Pinned Orca keeps two distinct fences: terminal.show and prompt receipts use the
// raw incarnationId; orchestration Task/Dispatch authority uses PTY:incarnation.
export function terminalIdentity(terminal) {
 const {ptyId,incarnationId}=terminal??{};
 if(typeof ptyId!=='string'||!ptyId||typeof incarnationId!=='string'||!incarnationId)throw Error('Exact native terminal PTY and incarnation are unverified.');
 return {ptyId,incarnationId,processIncarnation:`${ptyId}:${incarnationId}`};
}
// Legacy saved launch observations may lack PTY. They can be enriched only after
// the caller verifies handle, pane, workspace, host and runtime as well.
export function matchesTerminalObservation(terminal, saved) {
 if(!saved||(!saved.incarnationId&&!saved.processIncarnation))return false;
 const actual=terminalIdentity(terminal);
 return (!saved.incarnationId||saved.incarnationId===actual.incarnationId)&&(!saved.ptyId||saved.ptyId===actual.ptyId)&&(!saved.processIncarnation||saved.processIncarnation===actual.processIncarnation);
}
