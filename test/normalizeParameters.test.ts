import { describe, it, expect } from 'vitest';
import { GeminiLive, LiveTool } from '../src/index.js';

describe('GeminiLive normalizeParameters & Tool Registration', () => {
  const dummyApiKey = 'test-api-key';
  const dummyModel = 'gemini-3.8-live';

  it('normalizes basic scalar properties correctly', () => {
    const client = new GeminiLive(dummyApiKey, dummyModel, false, '');
    const schema = client.normalizeParameters({
      city: {
        type: 'string',
        description: 'Target city name',
        required: true
      },
      count: {
        type: 'integer',
        description: 'Number of results'
      }
    });

    expect(schema).toEqual({
      type: 'OBJECT',
      properties: {
        city: {
          type: 'STRING',
          description: 'Target city name'
        },
        count: {
          type: 'INTEGER',
          description: 'Number of results'
        }
      },
      required: ['city']
    });
  });

  it('normalizes array parameters with object items schema', () => {
    const client = new GeminiLive(dummyApiKey, dummyModel, false, '');
    const schema = client.normalizeParameters({
      suggestions: {
        type: 'array',
        description: 'List of suggestions',
        items: {
          type: 'string',
          description: 'A single recommendation'
        },
        required: true
      }
    });

    expect(schema).toEqual({
      type: 'OBJECT',
      properties: {
        suggestions: {
          type: 'ARRAY',
          description: 'List of suggestions',
          items: {
            type: 'STRING',
            description: 'A single recommendation'
          }
        }
      },
      required: ['suggestions']
    });
  });

  it('normalizes array parameters with string shorthand items', () => {
    const client = new GeminiLive(dummyApiKey, dummyModel, false, '');
    const schema = client.normalizeParameters({
      tags: {
        type: 'ARRAY',
        description: 'Categories',
        items: 'string'
      }
    });

    expect(schema.properties.tags).toEqual({
      type: 'ARRAY',
      description: 'Categories',
      items: {
        type: 'STRING'
      }
    });
  });

  it('provides safe fallback items: { type: "STRING" } when items is omitted on ARRAY type', () => {
    const client = new GeminiLive(dummyApiKey, dummyModel, false, '');
    const schema = client.normalizeParameters({
      tags: {
        type: 'array',
        description: 'Tags list without explicit items'
      }
    });

    expect(schema.properties.tags).toEqual({
      type: 'ARRAY',
      description: 'Tags list without explicit items',
      items: {
        type: 'STRING'
      }
    });
  });

  it('preserves enum values and description on array items', () => {
    const client = new GeminiLive(dummyApiKey, dummyModel, false, '');
    const schema = client.normalizeParameters({
      priorities: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH']
        }
      }
    });

    expect(schema.properties.priorities.items).toEqual({
      type: 'STRING',
      enum: ['LOW', 'MEDIUM', 'HIGH']
    });
  });

  it('handles empty or undefined parameters gracefully', () => {
    const client = new GeminiLive(dummyApiKey, dummyModel, false, '');
    expect(client.normalizeParameters(undefined)).toEqual({
      type: 'OBJECT',
      properties: {}
    });
    expect(client.normalizeParameters({})).toEqual({
      type: 'OBJECT',
      properties: {}
    });
  });

  it('registers tool with properly normalized parameters and exposes in registeredTools', () => {
    const saveRecommendationsTool: LiveTool = {
      name: 'saveRecommendations',
      description: 'Persists recommendations into the session',
      parameters: {
        notes: {
          type: 'string',
          description: 'Doctor notes'
        },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Actionable steps',
          required: true
        }
      },
      handler: (args) => ({ status: 'ok', count: args.suggestions?.length })
    };

    const client = new GeminiLive(
      dummyApiKey,
      dummyModel,
      false,
      '',
      'Test prompt',
      saveRecommendationsTool
    );

    expect(client.registeredTools).toHaveLength(1);
    const registered = client.registeredTools[0];
    expect(registered.name).toBe('saveRecommendations');
    expect(registered.parameters.properties.suggestions.items).toEqual({
      type: 'STRING'
    });
    expect(registered.parameters.required).toContain('suggestions');
  });

  it('normalizes nested OBJECT schemas with nested properties and required fields', () => {
    const client = new GeminiLive(dummyApiKey, dummyModel, false, '');
    const schema = client.normalizeParameters({
      location: {
        type: 'object',
        description: 'Geo-coordinates',
        properties: {
          latitude: { type: 'number', minimum: -90, maximum: 90, required: true },
          longitude: { type: 'number', minimum: -180, maximum: 180, required: true },
          accuracy: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] }
        },
        required: true
      }
    });

    expect(schema).toEqual({
      type: 'OBJECT',
      properties: {
        location: {
          type: 'OBJECT',
          description: 'Geo-coordinates',
          properties: {
            latitude: {
              type: 'NUMBER',
              description: 'The latitude parameter',
              minimum: -90,
              maximum: 90
            },
            longitude: {
              type: 'NUMBER',
              description: 'The longitude parameter',
              minimum: -180,
              maximum: 180
            },
            accuracy: {
              type: 'STRING',
              description: 'The accuracy parameter',
              enum: ['HIGH', 'MEDIUM', 'LOW']
            }
          },
          required: ['latitude', 'longitude']
        }
      },
      required: ['location']
    });
  });

  it('normalizes ARRAY of nested OBJECTs', () => {
    const client = new GeminiLive(dummyApiKey, dummyModel, false, '');
    const schema = client.normalizeParameters({
      itemsList: {
        type: 'array',
        description: 'Cart items',
        items: {
          type: 'object',
          description: 'A single cart item',
          properties: {
            productId: { type: 'string', required: true },
            quantity: { type: 'integer', minimum: 1, required: true }
          }
        }
      }
    });

    expect(schema.properties.itemsList).toEqual({
      type: 'ARRAY',
      description: 'Cart items',
      items: {
        type: 'OBJECT',
        description: 'A single cart item',
        properties: {
          productId: {
            type: 'STRING',
            description: 'The productId parameter'
          },
          quantity: {
            type: 'INTEGER',
            description: 'The quantity parameter',
            minimum: 1
          }
        },
        required: ['productId', 'quantity']
      }
    });
  });

  it('preserves string format and number min/max constraints', () => {
    const client = new GeminiLive(dummyApiKey, dummyModel, false, '');
    const schema = client.normalizeParameters({
      scheduledAt: {
        type: 'string',
        format: 'date-time',
        description: 'ISO timestamp'
      },
      score: {
        type: 'number',
        minimum: 0.0,
        maximum: 1.0,
        description: 'Score from 0.0 to 1.0'
      }
    });

    expect(schema.properties.scheduledAt).toEqual({
      type: 'STRING',
      format: 'date-time',
      description: 'ISO timestamp'
    });
    expect(schema.properties.score).toEqual({
      type: 'NUMBER',
      minimum: 0.0,
      maximum: 1.0,
      description: 'Score from 0.0 to 1.0'
    });
  });

  it('preserves nullable, minItems, maxItems, minLength, maxLength, pattern, default, and example attributes', () => {
    const client = new GeminiLive(dummyApiKey, dummyModel, false, '');
    const schema = client.normalizeParameters({
      notes: {
        type: 'string',
        nullable: true,
        default: 'No notes provided',
        example: 'Mild symptoms observed'
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 5
      },
      zipCode: {
        type: 'string',
        minLength: 5,
        maxLength: 6,
        pattern: '^[0-9]+$'
      }
    });

    expect(schema.properties.notes).toEqual({
      type: 'STRING',
      description: 'The notes parameter',
      nullable: true,
      default: 'No notes provided',
      example: 'Mild symptoms observed'
    });

    expect(schema.properties.tags).toEqual({
      type: 'ARRAY',
      description: 'The tags parameter',
      items: { type: 'STRING' },
      minItems: 1,
      maxItems: 5
    });

    expect(schema.properties.zipCode).toEqual({
      type: 'STRING',
      description: 'The zipCode parameter',
      minLength: 5,
      maxLength: 6,
      pattern: '^[0-9]+$'
    });
  });
});
