import { AsyncLocalStorage } from 'async_hooks';

export interface RuntimeTraceContext {
  runId?: string;
  companyId?: string;
  correlationId?: string;
}

const runtimeTraceContext = new AsyncLocalStorage<RuntimeTraceContext>();

function compactContext(context: RuntimeTraceContext): RuntimeTraceContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== '')
  ) as RuntimeTraceContext;
}

export function getRuntimeTraceContext(): RuntimeTraceContext {
  return runtimeTraceContext.getStore() ?? {};
}

export function withRuntimeTraceContext<T>(
  context: RuntimeTraceContext,
  fn: () => T
): T {
  const parent = getRuntimeTraceContext();
  return runtimeTraceContext.run(compactContext({ ...parent, ...context }), fn);
}
