declare module 'node:test' {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
}

declare module 'node:assert/strict' {
  export function equal(actual: unknown, expected: unknown, message?: string): void;
  export function notEqual(actual: unknown, expected: unknown, message?: string): void;
  export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
  export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
  export function notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
  export function ok(value: unknown, message?: string): void;
  export function throws(block: () => unknown, error?: unknown, message?: string): void;
  export function doesNotThrow(block: () => unknown, message?: string): void;
  export function rejects(asyncBlock: (() => Promise<unknown>) | Promise<unknown>, error?: unknown, message?: string): Promise<void>;
  export function doesNotReject(asyncBlock: (() => Promise<unknown>) | Promise<unknown>, message?: string): Promise<void>;
  const assert: {
    equal: typeof equal;
    notEqual: typeof notEqual;
    strictEqual: typeof strictEqual;
    deepEqual: typeof deepEqual;
    notDeepEqual: typeof notDeepEqual;
    ok: typeof ok;
    throws: typeof throws;
    doesNotThrow: typeof doesNotThrow;
    rejects: typeof rejects;
    doesNotReject: typeof doesNotReject;
  };
  export default assert;
}

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(location: string, options?: unknown);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): { changes: number; lastInsertRowid: number };
      get(...params: unknown[]): unknown;
    };
  }
}

