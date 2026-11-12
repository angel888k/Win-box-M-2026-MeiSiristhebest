// src/engine/js/sandboxGuard.ts
// Hardens node:vm context against prototype pollution and prototype traversal escapes
// (e.g. this.constructor.constructor('return process')()).
import vm from 'node:vm';

export interface HardenedContext {
  ctx: vm.Context;
  globals: Record<string, unknown>;
  getVmObjectConstructor: () => unknown;
}

/**
 * Creates a proxy around host objects injected into node:vm so that traversing
 * .constructor / .__proto__ returns the VM realm's Object or null rather than the host realm's
 * Object/Function constructor.
 */
export function createSandboxProxy<T>(target: T, getVmConstructor: () => unknown): T {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
    return target;
  }
  if (target instanceof Uint8Array || target instanceof ArrayBuffer || (typeof Buffer !== 'undefined' && Buffer.isBuffer(target))) {
    return target;
  }

  const proxyMap = new WeakMap<object, unknown>();

  function wrap(val: unknown): unknown {
    if (val === null || (typeof val !== 'object' && typeof val !== 'function')) {
      return val;
    }
    if (val instanceof Uint8Array || val instanceof ArrayBuffer || (typeof Buffer !== 'undefined' && Buffer.isBuffer(val))) {
      return val;
    }
    if (proxyMap.has(val as object)) {
      return proxyMap.get(val as object);
    }
    const proxy = new Proxy(val as object, {
      get(t, prop, receiver) {
        if (prop === 'constructor') {
          return getVmConstructor() ?? undefined;
        }
        if (prop === '__proto__') {
          return null;
        }
        const res = Reflect.get(t, prop, receiver);
        const desc = Object.getOwnPropertyDescriptor(t, prop);
        if (desc && !desc.configurable && !desc.writable) {
          return res;
        }
        if (typeof res === 'function') {
          return wrap(function (this: unknown, ...args: unknown[]) {
            const out = Reflect.apply(res, t, args);
            return wrap(out);
          });
        }
        return wrap(res);
      },
      getPrototypeOf(t) {
        try {
          if (!Object.isExtensible(t)) {
            return Reflect.getPrototypeOf(t);
          }
        } catch {
          // ignore
        }
        return null;
      },
      apply(t, thisArg, args) {
        const out = Reflect.apply(t as (...args: unknown[]) => unknown, thisArg, args);
        return wrap(out);
      },
      set(t, prop, value, receiver) {
        return Reflect.set(t, prop, value, receiver);
      },
    });
    proxyMap.set(val as object, proxy);
    return proxy;
  }

  return wrap(target) as T;
}

/**
 * Builds a secure vm.Context whose global object has a null prototype and whose
 * injected host globals are proxy-isolated against prototype traversal.
 */
export function buildHardenedContext(rawGlobals: Record<string, unknown>): HardenedContext {
  let vmObjectConstructor: unknown = null;
  const globals: Record<string, unknown> = Object.create(null);

  for (const [key, value] of Object.entries(rawGlobals)) {
    globals[key] = createSandboxProxy(value, () => vmObjectConstructor);
  }

  const ctx = vm.createContext(globals);
  vmObjectConstructor = vm.runInContext('Object', ctx);

  return {
    ctx,
    globals,
    getVmObjectConstructor: () => vmObjectConstructor,
  };
}
