/** Tiny class-name joiner. Avoids a dependency for something this small. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
