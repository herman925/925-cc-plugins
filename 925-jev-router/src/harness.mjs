import { planPreCall } from './hook.mjs';

export async function runSyntheticPreCall(fixture) {
  const responses = [...(fixture.transportResponses ?? [])];
  const calls = [];
  const transport = async (body, meta) => {
    calls.push({ body, attempt: meta?.attempt ?? 0 });
    if (responses.length === 0) {
      const error = new Error('Synthetic transport has no further response.');
      error.transient = false;
      throw error;
    }
    const next = responses.shift();
    if (next && next.throw) {
      const error = new Error(next.message ?? 'Synthetic TypeSafe failure');
      error.transient = Boolean(next.transient);
      error.status = next.status ?? null;
      throw error;
    }
    return next;
  };
  const planned = await planPreCall(fixture.request, {
    projectRoot: fixture.projectRoot,
    policy: fixture.policy,
    eligible: fixture.eligible,
    agent: fixture.agent,
    transport,
  });
  return { ...planned, calls, ignoredModelList: fixture.modelList ?? null };
}
