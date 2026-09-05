/**
 * Removes undefined values from a partial object.
 * Returns a new object containing only the keys whose values are not undefined.
 */
export function pickDefined<T extends object>(patch: Partial<T>): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([_, value]) => value !== undefined),
  ) as Partial<T>;
}
