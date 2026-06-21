/**
 * Ambient module declaration for @vscode/sqlite3.
 *
 * The actual package lives in extension/node_modules (not shared/), so tsc
 * cannot resolve it. We declare the module shape here so dynamic import()
 * type-checks without needing the real package installed in shared/.
 *
 * The runtime import is resolved by:
 *   - esbuild --external (extension bundle)
 *   - vitest resolve.alias (tests)
 */
declare module "@vscode/sqlite3" {
  const sqlite3: {
    Database: new (
      filename: string,
      callback?: (err: Error | null) => void
    ) => {
      exec(sql: string): void;
      run(sql: string, params?: unknown[]): Promise<void>;
      get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
      all<T>(sql: string, params?: unknown[]): Promise<T[]>;
      close(): Promise<void>;
    };
    OPEN_READWRITE: number;
    OPEN_CREATE: number;
  };
  export = sqlite3;
}
