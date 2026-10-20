/** Loose check (something@something.tld); the backend decides whether the account exists. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailShape(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}
