import { AsyncLocalStorage } from "node:async_hooks";

export interface HostedUserContext {
  username: string;
  token: string;
  groups: string[];
}

export interface RequestContext {
  hostedUser?: HostedUserContext;
}

const requestContextStorageKey = "__openclawInstallerRequestContextStorage";
const sharedGlobal = globalThis as typeof globalThis & {
  [requestContextStorageKey]?: AsyncLocalStorage<RequestContext>;
};

const requestContextStorage =
  sharedGlobal[requestContextStorageKey] ??= new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function currentHostedUser(): HostedUserContext | undefined {
  return currentRequestContext()?.hostedUser;
}
