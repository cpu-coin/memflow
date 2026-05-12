declare module "better-sqlite3" {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): RunResult;
  }

  interface Database {
    close(): void;
    exec(sql: string): this;
    pragma(source: string): unknown;
    prepare(sql: string): Statement;
    transaction<T>(fn: (arg: T) => void): (arg: T) => void;
  }

  interface Options {
    readonly?: boolean;
    verbose?: ((message?: unknown, ...optionalParams: unknown[]) => void) | undefined;
  }

  const Database: {
    new (filename: string, options?: Options): Database;
  };

  namespace Database {
    export type Database = import("better-sqlite3").Database;
  }

  export default Database;
}
