import { spawnSync } from 'node:child_process';
import { postgresTestUrl } from './support/engines.mjs';

if (!postgresTestUrl()) {
  console.error('Set TEAM_STORE_TEST_POSTGRES to a dedicated loopback team_store_contract_test database. PostgreSQL coverage is required for this command.');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
