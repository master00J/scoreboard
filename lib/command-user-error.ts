/** Fout die de control-UI vertaalt via `commandErrors.<code>`. */
export class CommandUserError extends Error {
  readonly code: string;
  readonly params: Record<string, string | number>;

  constructor(code: string, params: Record<string, string | number> = {}) {
    super(code);
    this.name = "CommandUserError";
    this.code = code;
    this.params = params;
  }
}

export function isCommandUserError(err: unknown): err is CommandUserError {
  return err instanceof CommandUserError;
}
