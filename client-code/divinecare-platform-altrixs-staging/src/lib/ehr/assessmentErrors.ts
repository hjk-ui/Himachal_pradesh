export class AssessmentError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409) { super(message); }
}
