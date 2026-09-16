import type { GenericValidator } from 'convex/values';

/** Structural validation for the HTTP boundary, derived from the Convex contract. */
export function matchesValidator(value: unknown, validator: GenericValidator): boolean {
  switch (validator.kind) {
    case 'null': return value === null;
    case 'string': return typeof value === 'string';
    case 'float64': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'literal': return value === validator.value;
    case 'union': return validator.members.some((member: GenericValidator) => matchesValidator(value, member));
    case 'array': return Array.isArray(value) && value.every((item) => matchesValidator(item, validator.element));
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const object = value as Record<string, unknown>;
      const prototype = Object.getPrototypeOf(object);
      if (prototype !== Object.prototype && prototype !== null) return false;
      if (Object.keys(object).some((key) => !Object.prototype.hasOwnProperty.call(validator.fields, key))) return false;
      return Object.entries(validator.fields).every(([key, field]) =>
        Object.prototype.hasOwnProperty.call(object, key) ? matchesValidator(object[key], field) : field.isOptional === 'optional',
      );
    }
    // This contract is JSON-only. New validator types must be handled explicitly.
    default: return false;
  }
}
