export function prepareDocument<T extends Record<string, any>>(id: string, value: T, now: string): T {
  return stripUndefinedValues({
    ...value,
    id: (value.id as string | undefined) || id,
    updatedAt: now,
    createdAt: value.createdAt || now
  } as T);
}

export function stripUndefinedValues<T>(value: T): T {
  if (value === undefined) {
    return undefined as T;
  }
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined).map((entry) => stripUndefinedValues(entry)) as T;
  }
  if (isPlainRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        next[key] = stripUndefinedValues(entry);
      }
    }
    return next as T;
  }
  return value;
}

export function withDocumentId<T extends Record<string, any>>(id: string, value: T): T {
  return {
    ...cloneDocumentValue(value),
    id: typeof value.id === "string" && value.id.trim() ? value.id : id
  };
}

export function cloneDocumentValue<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneDocumentValue(entry)) as T;
  }
  if (isPlainRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = cloneDocumentValue(entry);
    }
    return next as T;
  }
  return value;
}

export function isExpired(expiresAt: unknown, now = Date.now()): boolean {
  const expiresAtMs = toMillis(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= now;
}

function toMillis(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Date.parse(value);
  }
  return Number.NaN;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
