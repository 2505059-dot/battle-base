import { isDeepStrictEqual } from 'node:util';

const validationKeywords = new Set(['$ref', 'type', 'enum', 'const', 'required', 'properties', 'additionalProperties', 'items', 'minimum', 'pattern', 'format', 'anyOf']);
const annotationKeywords = new Set(['$schema', '$id', '$defs', '$comment', 'title', 'description', 'default', 'examples', 'version']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const escapePointer = value => value.replace(/~/g, '~0').replace(/\//g, '~1');
const fail = (path, message) => { throw new Error('Schema violation at ' + path + ': ' + message); };

function matchesType(value, type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some(item => {
    if (item === 'null') return value === null;
    if (item === 'object') return isObject(value);
    if (item === 'array') return Array.isArray(value);
    if (item === 'integer') return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
    if (item === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (item === 'string') return typeof value === 'string';
    if (item === 'boolean') return typeof value === 'boolean';
    return false;
  });
}

function resolveReference(reference, root, path) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) fail(path, 'only local JSON Schema references are supported');
  let target = root;
  for (const token of reference.slice(2).split('/')) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(target) || !Object.hasOwn(target, key)) fail(path, 'unresolved schema reference ' + reference);
    target = target[key];
  }
  return target;
}

function validate(value, schema, root, path) {
  if (schema === true) return;
  if (schema === false) fail(path, 'value is forbidden');
  if (!isObject(schema)) fail(path, 'invalid schema node');
  for (const keyword of Object.keys(schema)) {
    if (!validationKeywords.has(keyword) && !annotationKeywords.has(keyword)) fail(path, 'unsupported schema keyword ' + keyword);
  }
  if (schema.$ref) validate(value, resolveReference(schema.$ref, root, path), root, path);
  if (Object.hasOwn(schema, 'const') && !isDeepStrictEqual(value, schema.const)) fail(path, 'does not equal the declared constant');
  if (schema.enum && !schema.enum.some(item => isDeepStrictEqual(value, item))) fail(path, 'is not in the declared enum');
  if (schema.type && !matchesType(value, schema.type)) fail(path, 'has the wrong JSON type; expected ' + JSON.stringify(schema.type));
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) fail(path, 'is below the declared minimum');
  if (typeof value === 'string' && schema.pattern !== undefined && !(new RegExp(schema.pattern)).test(value)) fail(path, 'does not match the declared pattern');
  if (typeof value === 'string' && schema.format === 'date') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00.000Z') : null;
    if (!date || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) fail(path, 'is not a valid date');
  } else if (schema.format !== undefined && schema.format !== 'date') fail(path, 'unsupported declared format ' + schema.format);
  if (schema.anyOf) {
    let accepted = false;
    const branchErrors = [];
    for (const branch of schema.anyOf) {
      try { validate(value, branch, root, path); accepted = true; break; }
      catch (error) { branchErrors.push(error.message); }
    }
    if (!accepted) fail(path, 'does not match any allowed schema branch: ' + branchErrors.join(' | '));
  }
  if (isObject(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(path, 'is missing required property ' + JSON.stringify(key));
    for (const [key, item] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validate(value[key], item, root, path + '/' + escapePointer(key));
    }
    if (schema.additionalProperties !== undefined) {
      for (const [key, item] of Object.entries(value)) {
        if (!Object.hasOwn(properties, key)) {
          if (schema.additionalProperties === false) fail(path + '/' + escapePointer(key), 'additional property is forbidden');
          if (schema.additionalProperties !== true) validate(item, schema.additionalProperties, root, path + '/' + escapePointer(key));
        }
      }
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => validate(item, schema.items, root, path + '/' + index));
}

export function validateDeclaredSchema(value, schema) {
  validate(value, schema, schema, '$');
  return true;
}
