import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { roleText, mergeRole } from '../role-files.mjs';
import { createKeyedSerializer } from './keyed-serializer.mjs';
const serialize = createKeyedSerializer();
export async function projectRoot(workspace, scope) {
  if (scope.executionHostId !== 'local') throw Error('Persistent team role files require a local execution host; remote project writes are unsupported.');
  if (workspace.id !== scope.workspaceId || (workspace.hostId ?? workspace.identity?.executionHostId) !== scope.executionHostId || typeof workspace.path !== 'string' || !isAbsolute(workspace.path)) throw Error('The native project path or execution host is unverified; no role files were written.');
  const root = await realpath(workspace.path);
  if (!(await lstat(root)).isDirectory()) throw Error('The project path is not a directory.');
  if (scope.projectPath && root !== scope.projectPath) throw Error('The saved project path changed; no role files were written.');
  return root;
}
export async function syncProjectRoles(team, root) {
  return serialize(root, async () => {
    if (await realpath(root) !== root) throw Error('The project path changed.');
    const inside = path => { const rel = relative(root, path); if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error('Role path escaped the project.'); };
    async function directory(parent, name) {
      const path = join(parent, name); inside(path);
      try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw Error('Team role directories must not be symlinks or junctions.');
      return path;
    }
    async function existing(path) {
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) throw Error('Unsafe or oversized existing team file; no overwrite permitted.');
        return await readFile(path, 'utf8');
      } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    }
    async function write(path, text, before) {
      if (text === before) return;
      const temp = `${path}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temp, 'wx', 0o600);
        try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        // Refuse concurrent personal-note edits instead of silently dropping them.
        if (await existing(path) !== before) throw Error('Team file changed during generation; retry before launching.');
        await rename(temp, path);
      } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    const base = await directory(await directory(root, '.orca'), 'team-orchestrator');
    const ignore = join(base, '.gitignore'), oldIgnore = await existing(ignore);
    if (!oldIgnore?.split(/\r?\n/).includes('*')) await write(ignore, `${oldIgnore ?? ''}\n# Local generated team views and personal notes\n*\n`, oldIgnore);
    if (!/^[a-f0-9-]{36}$/.test(team.id)) throw Error('Invalid team file identity.');
    const teamDir = await directory(base, team.id), roles = await directory(teamDir, 'roles');
    for (const member of team.members) {
      if (!/^[a-f0-9-]{36}$/.test(member.id)) throw Error('Invalid member file identity.');
      const path = join(roles, `${member.id}.md`), before = await existing(path);
      await write(path, mergeRole(before, roleText(team, member)), before);
    }
    // Publish the roster last. A partial failed write is repaired before launch.
    for (const [name, value] of [['configuration.json', { generated: true, teamId: team.id, configVersion: team.configVersion, configuration: team.configuration }], ['roster.json', { generated: true, teamId: team.id, name: team.name, configVersion: team.configVersion, members: team.members.map(({ id, name, boss, role, roleVersion, brief, habits, collaboration, agent, model, effort }) => ({ id, name, boss, role, roleVersion, brief, habits, collaboration, agent, model, effort })) }]]) {
      const path = join(teamDir, name); await write(path, JSON.stringify(value, null, 2) + '\n', await existing(path));
    }
  });
}
