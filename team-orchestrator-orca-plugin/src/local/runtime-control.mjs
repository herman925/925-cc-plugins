// Creation provenance stays in binding.runtimeId. This separately authenticated
// desktop transport epoch is scoped to one unchanged Work/Run and recipient set.
export const controlRuntime = (work) => work?.runtimeControl?.runtimeId ?? work?.binding?.runtimeId;
export function memberControlRuntime(work, operation) {
  const control = work?.runtimeControl;
  return control?.members?.some(
    (row) =>
      row.requestId === operation.requestId &&
      row.memberId === operation.memberId &&
      row.instanceGeneration === (operation.instanceGeneration ?? 1),
  )
    ? control.runtimeId
    : operation.runtimeId;
}
