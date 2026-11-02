// Exercise the installed host's pure mention parser, not a hand-copied regex.
// No UI input, model turn, installed configuration or host source is modified.
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const asset=process.argv[2];if(!asset)throw Error('Supply the installed Orca composer asset path.');
const source=await readFile(asset,'utf8');
const match=source.match(/function (\w+)\(e\)\{let t=e\.match\((\w+)\)\?\.\[1\]\?\?null;if\(!t\)return t;let n=t\.match\(\/\^\[\\w:-\]\*\/\)\?\.\[0\]\?\?``;return n===``\|\|n===`_`\|\|\/\^\[-\\d\]\/.test\(n\)\|\|!\/\[a-z\]\/.test\(n\)&&([\w$]+)\.has\(n\.toUpperCase\(\)\)\?null:t\}/);
assert.ok(match,'The current host parser could not be isolated; inspect the asset before changing this probe.');
const [,fn,pattern,environments]=match,context={[pattern]:/(?:^|\s)\$(\S*)$/,[environments]:new Set('PATH HOME USER SHELL PWD TMPDIR TEMP TMP LANG TERM XDG_CONFIG_HOME'.split(' '))};
const parse=runInNewContext(`(${match[0]})`,context,{timeout:1000});
const cases=[['$925-to',null],['$925-to:925-to',null],['$team-orchestration-925','team-orchestration-925'],['$team-orchestration-925:team-orchestration-925','team-orchestration-925:team-orchestration-925']];
for(const [input,expected]of cases)assert.equal(parse(input),expected);
const root=await mkdtemp(join(tmpdir(),'team-skill-invocation-')),evidence={asset,assetSha256:createHash('sha256').update(source).digest('hex'),parserName:fn,parser:match[0],cases:cases.map(([input,expected])=>({input,expected,actual:parse(input)})),modelTurnsStarted:0,passed:true};
await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({root,passed:true,cases:evidence.cases}));
