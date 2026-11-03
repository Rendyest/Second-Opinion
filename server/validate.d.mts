export interface CoachValidation {
  ok: boolean;
  error?: string;
}

export function validateCoachSummary(body: unknown): CoachValidation;

export const ALLOWED_SUMMARY_KEYS: readonly string[];
