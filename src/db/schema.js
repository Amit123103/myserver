'use strict';

/**
 * Custom Zero-Dependency Schema Validator
 * Validates object structures, constraints, formats, and data types without external packages.
 */

class Schema {
  constructor(definition) {
    this.definition = definition;
  }

  validate(input, isUpdate = false) {
    const errors = [];
    const sanitized = {};

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, errors: ['Input must be a valid JSON object'], data: null };
    }

    for (const [field, rule] of Object.entries(this.definition)) {
      let value = input[field];

      // Handle defaults
      if (value === undefined && rule.default !== undefined && !isUpdate) {
        value = typeof rule.default === 'function' ? rule.default() : JSON.parse(JSON.stringify(rule.default));
      }

      // Check required
      if (rule.required && !isUpdate && (value === undefined || value === null || value === '')) {
        errors.push(`Field '${field}' is required`);
        continue;
      }

      if (value === undefined) {
        continue;
      }

      // Check type
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (rule.type && actualType !== rule.type) {
        errors.push(`Field '${field}' must be of type ${rule.type}, received ${actualType}`);
        continue;
      }

      // Strings
      if (rule.type === 'string') {
        if (rule.trim) value = value.trim();
        if (rule.minLength !== undefined && value.length < rule.minLength) {
          errors.push(`Field '${field}' length must be at least ${rule.minLength}`);
        }
        if (rule.maxLength !== undefined && value.length > rule.maxLength) {
          errors.push(`Field '${field}' length must not exceed ${rule.maxLength}`);
        }
        if (rule.enum && !rule.enum.includes(value)) {
          errors.push(`Field '${field}' must be one of: [${rule.enum.join(', ')}]`);
        }
        if (rule.pattern && !rule.pattern.test(value)) {
          errors.push(`Field '${field}' does not match required format`);
        }
      }

      // Numbers
      if (rule.type === 'number') {
        if (Number.isNaN(value)) {
          errors.push(`Field '${field}' must be a valid number`);
        }
        if (rule.min !== undefined && value < rule.min) {
          errors.push(`Field '${field}' must be >= ${rule.min}`);
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push(`Field '${field}' must be <= ${rule.max}`);
        }
      }

      // Arrays
      if (rule.type === 'array') {
        if (rule.minItems !== undefined && value.length < rule.minItems) {
          errors.push(`Field '${field}' must contain at least ${rule.minItems} items`);
        }
        if (rule.itemType) {
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] !== rule.itemType) {
              errors.push(`Item at index ${i} in '${field}' must be of type ${rule.itemType}`);
            }
          }
        }
      }

      sanitized[field] = value;
    }

    // Strip un-defined properties if strict
    return {
      valid: errors.length === 0,
      errors,
      data: sanitized
    };
  }
}

// Built-in schema for Notes
const NoteSchema = new Schema({
  id: {
    type: 'string',
    required: false
  },
  title: {
    type: 'string',
    required: true,
    trim: true,
    minLength: 1,
    maxLength: 200
  },
  content: {
    type: 'string',
    required: true,
    trim: true,
    maxLength: 50000
  },
  status: {
    type: 'string',
    required: false,
    enum: ['todo', 'in_progress', 'completed', 'archived'],
    default: 'todo'
  },
  priority: {
    type: 'string',
    required: false,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  tags: {
    type: 'array',
    required: false,
    itemType: 'string',
    default: []
  },
  createdAt: {
    type: 'string',
    required: false
  },
  updatedAt: {
    type: 'string',
    required: false
  }
});

module.exports = {
  Schema,
  NoteSchema
};
