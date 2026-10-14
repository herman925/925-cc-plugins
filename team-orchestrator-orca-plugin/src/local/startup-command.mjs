// Briefs ride the new agent's command line; never paste into an existing session.
export function startupCommand(params, platform = 'posix') {
  if (params.agent === 'claude' && params.effort === 'xhigh') throw new Error('Claude Code does not accept xhigh effort. Choose high or a default.');
  const args = [params.agent];
  if (params.model) args.push('--model', params.model);
  if (params.effort) args.push(...(params.agent === 'codex' ? ['-c', `model_reasoning_effort=${params.effort}`] : ['--effort', params.effort]));
  args.push('--', params.brief.replace(/[\r\n]+/g, ' '));
  if (args.some(value => /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value))) throw new Error('Control characters are not allowed in a startup command.');
  if (platform === 'powershell') return '& ' + args.map(value => "'" + value.replaceAll("'", "''") + "'").join(' ');
  return args.map(value => "'" + value.replaceAll("'", "'\"'\"'") + "'").join(' ');
}
