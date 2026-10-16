// Creation provenance stays in binding.runtimeId. This separately authenticated
// desktop transport epoch is scoped to one unchanged Work/Run and recipient set.
export const controlRuntime = (work) => work?.runtimeControl?.runtimeId ?? work?.binding?.runtimeId;
export function memberControlRuntime(work, operation) {
  const control = work?.runtimeControl;
  const recorded = control?.members?.find(
    (row) =>
      row.requestId === operation.requestId &&
      row.memberId === operation.memberId &&
      row.instanceGeneration === (operation.instanceGeneration ?? 1),
  );
  if (!recorded) return operation.runtimeId;
  const proof = control.proof.members.find(
    (row) => row.requestId === operation.requestId && row.memberId === operation.memberId,
  );
  if (
    !proof ||
    operation.runtimeId !== work.binding.runtimeId ||
    operation.kind !== 'terminal' ||
    operation.handle !== proof.handle ||
    operation.paneKey !== proof.paneKey ||
    operation.nativeRequest.agent !== proof.agent ||
    ['ptyId', 'incarnationId', 'processIncarnation'].some(
      (key) => operation.observation?.[key] !== proof[key],
    )
  ) {
    throw Error(
      'The prepared member changed after reconnect. Its earlier control proof cannot redirect a new assignment.',
    );
  }
  return control.runtimeId;
}
