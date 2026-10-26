import { ParameterProperty, LiveTool } from './types.js';

/**
 * Automatically normalizes user-supplied parameters into the standard
 * OpenAPI schema required by Gemini Live WebSocket setup (supports recursion
 * for nested objects and arrays of objects).
 */
export function normalizeParameters(rawParams?: Record<string, any>): Record<string, any> {
  if (!rawParams || Object.keys(rawParams).length === 0) {
    return {
      type: 'OBJECT',
      properties: {}
    };
  }

  const properties: Record<string, any> = {};
  const required: string[] = Array.isArray(rawParams.required) ? [...rawParams.required] : [];
  const sourceProps = rawParams.properties || rawParams;

  for (const [key, val] of Object.entries(sourceProps)) {
    if (key === 'type' || key === 'required' || typeof val !== 'object' || !val) continue;

    const prop = val as ParameterProperty;
    properties[key] = normalizeProperty(key, prop);

    if (prop.required === true && !required.includes(key)) {
      required.push(key);
    }
  }

  return {
    type: 'OBJECT',
    properties,
    ...(required.length > 0 ? { required } : {})
  };
}

/**
 * Helper to normalize an individual property or schema node recursively.
 */
export function normalizeProperty(key: string, prop: Record<string, any>, isItem: boolean = false): Record<string, any> {
  const propType = (prop.type || 'string').toUpperCase();
  const result: Record<string, any> = {
    type: propType
  };

  if (prop.description) {
    result.description = prop.description;
  } else if (!isItem) {
    result.description = `The ${key} parameter`;
  }

  if (prop.enum) {
    result.enum = prop.enum;
  }
  if (prop.format) {
    result.format = prop.format;
  }
  if (typeof prop.minimum === 'number') {
    result.minimum = prop.minimum;
  }
  if (typeof prop.maximum === 'number') {
    result.maximum = prop.maximum;
  }
  if (typeof prop.nullable === 'boolean') {
    result.nullable = prop.nullable;
  }
  if (typeof prop.minItems === 'number') {
    result.minItems = prop.minItems;
  }
  if (typeof prop.maxItems === 'number') {
    result.maxItems = prop.maxItems;
  }
  if (typeof prop.minLength === 'number') {
    result.minLength = prop.minLength;
  }
  if (typeof prop.maxLength === 'number') {
    result.maxLength = prop.maxLength;
  }
  if (typeof prop.pattern === 'string') {
    result.pattern = prop.pattern;
  }
  if (prop.default !== undefined) {
    result.default = prop.default;
  }
  if (prop.example !== undefined) {
    result.example = prop.example;
  }
  if (Array.isArray(prop.examples)) {
    result.examples = prop.examples;
  }

  // 1. Nested OBJECT schema: normalize nested properties
  if (propType === 'OBJECT' || prop.properties) {
    result.type = 'OBJECT';
    const nestedNormalized = normalizeParameters({
      properties: prop.properties || {},
      required: prop.required
    });
    result.properties = nestedNormalized.properties;
    if (nestedNormalized.required && nestedNormalized.required.length > 0) {
      result.required = nestedNormalized.required;
    }
  }

  // 2. ARRAY schema: normalize items schema
  if (propType === 'ARRAY') {
    if (prop.items) {
      if (typeof prop.items === 'string') {
        result.items = { type: prop.items.toUpperCase() };
      } else if (typeof prop.items === 'object') {
        result.items = normalizeProperty('item', prop.items, true);
      }
    } else {
      // Fallback default to prevent schema validation failure
      result.items = { type: 'STRING' };
    }
  }

  return result;
}

export function parseToolDeclarations(tools: LiveTool | LiveTool[]): {
  declarations: any[];
  handlers: { [key: string]: (args: Record<string, any>) => any | Promise<any> };
} {
  const declarations: any[] = [];
  const handlers: { [key: string]: (args: Record<string, any>) => any | Promise<any> } = {};

  if (!tools) return { declarations, handlers };
  const toolList = Array.isArray(tools) ? tools : [tools];

  for (const tool of toolList) {
    if (!tool || !tool.name || typeof tool.handler !== 'function') continue;

    const normalizedParams = normalizeParameters(tool.parameters);

    declarations.push({
      name: tool.name,
      description: tool.description || `Calls the ${tool.name} function`,
      parameters: normalizedParams,
      ...(tool.behavior ? { behavior: tool.behavior } : {})
    });

    handlers[tool.name] = tool.handler;
  }

  return { declarations, handlers };
}
