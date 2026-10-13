/**
 * The password policy of the API (registration, reset, change): 8 to 128 characters. Characters are
 * counted as code points like the backend (`[..."ä"]` is 1, an emoji 1). bcrypt only reads 72 bytes; the
 * backend pre-hashes longer passwords, the maximum just keeps inputs small.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export type PasswordProblem = "missing" | "short" | "long";

export function passwordProblem(password: string): PasswordProblem | null {
  const length = [...password].length;
  if (length === 0) return "missing";
  if (length < PASSWORD_MIN) return "short";
  if (length > PASSWORD_MAX) return "long";
  return null;
}
