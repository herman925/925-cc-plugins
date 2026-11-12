import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownedClaudeEnvironment} from '../src/claude-driver.mjs';
test('owned Claude removes inherited controller identity while preserving native authentication and configuration',()=>{
 const input={ORCA_TERMINAL_HANDLE:'parent',ORCA_CLI_COMMAND:'parent-host',TEAM_PROJECT_ROOT:'parent',TEAM_RESERVED_LAUNCH_PROFILE:'parent',CODEX_THREAD_ID:'parent',CODEX_SESSION_ID:'parent',CLAUDE_SESSION_ID:'parent',CLAUDE_CODE_SESSION_ID:'parent',CODEX_HOME:'configured-home',CLAUDE_CONFIG_DIR:'configured-Claude-home',ANTHROPIC_API_KEY:'fixture-key-not-a-secret',ANTHROPIC_BASE_URL:'http://127.0.0.1:1',PATH:'native-path'},output=ownedClaudeEnvironment(input);
 assert.deepEqual(output,{CODEX_HOME:'configured-home',CLAUDE_CONFIG_DIR:'configured-Claude-home',ANTHROPIC_API_KEY:'fixture-key-not-a-secret',ANTHROPIC_BASE_URL:'http://127.0.0.1:1',PATH:'native-path'});assert.equal(input.ORCA_TERMINAL_HANDLE,'parent');assert.equal(input.TEAM_RESERVED_LAUNCH_PROFILE,'parent');
});
