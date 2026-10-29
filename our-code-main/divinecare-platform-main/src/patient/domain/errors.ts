export class PatientAppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields?: Record<string, string>
  ) {
    super(message);
    this.name = 'PatientAppError';
  }
}
