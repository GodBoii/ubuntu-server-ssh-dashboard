/**
 * Small decoders for everything the controller sends back.
 *
 * The payloads originate from `remote_ops.py` on the Ubuntu host. When that
 * helper is older than the browser bundle, fields go missing. Required fields
 * fail loudly here; fields added later fall back to a neutral value so a stale
 * helper degrades to fewer panels instead of a blank screen.
 */

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeError";
  }
}

function reject(path: string, expected: string, value: unknown): never {
  throw new DecodeError(`${path} should be ${expected}, received ${typeof value}`);
}

export function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) reject(path, "an object", value);
  return Object.fromEntries(Object.entries(value));
}

export function text(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string") reject(`${path}.${key}`, "a string", value);
  return value;
}

export function number(source: Record<string, unknown>, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) reject(`${path}.${key}`, "a finite number", value);
  return value;
}

export function boolean(source: Record<string, unknown>, key: string, path: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") reject(`${path}.${key}`, "a boolean", value);
  return value;
}

export function list<T>(value: unknown, path: string, decode: (item: unknown, itemPath: string) => T): T[] {
  if (!Array.isArray(value)) reject(path, "an array", value);
  return value.map((item, index) => decode(item, `${path}[${index}]`));
}

export function optionalText(source: Record<string, unknown>, key: string, fallback = ""): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

export function optionalNumber(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function optionalBoolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

export function nullableText(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function nullableNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function optionalList<T>(source: Record<string, unknown>, key: string, path: string, decode: (item: unknown, itemPath: string) => T): T[] {
  const value = source[key];
  return Array.isArray(value) ? list(value, `${path}.${key}`, decode) : [];
}

export function literal<const T extends readonly string[]>(
  source: Record<string, unknown>,
  key: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const value = source[key];
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

/** A load average is always three numbers. Model it as a tuple so callers cannot index past it. */
export function loadTriple(value: unknown, path: string): [number, number, number] {
  const values = list(value, path, (item, itemPath) => {
    if (typeof item !== "number" || !Number.isFinite(item)) reject(itemPath, "a finite number", item);
    return item;
  });
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}
