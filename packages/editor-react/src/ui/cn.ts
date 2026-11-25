export type ClassValue = string | false | null | undefined;

/** Joins class names. Utility conflicts are resolved by writing them once, not by merging. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
