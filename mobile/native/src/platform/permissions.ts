// iOS permission dialogs can emit inactive -> active without backgrounding.
// Never treat that transition as account loss or cancel the user's Start.
let prompts = 0;
let previous: Promise<unknown> = Promise.resolve();
export const permissionPending = () => prompts > 0;
export function duringPermission<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  prompts++;
  const next = previous.catch(() => {}).then(() => {
    if (signal?.aborted) throw Error('cancelled');
    return request();
  }).finally(() => { prompts--; });
  previous = next;
  return next;
}
