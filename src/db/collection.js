'use strict';

/**
 * Custom Zero-Dependency In-Memory Collection with Secondary Indexing
 */

class Collection {
  constructor(name, schema = null, indexedFields = ['status']) {
    this.name = name;
    this.schema = schema;
    this.documents = new Map(); // id -> doc
    this.indexes = new Map(); // fieldName -> Map<value, Set<id>>

    this.indexedFields = indexedFields;
    for (const field of this.indexedFields) {
      this.indexes.set(field, new Map());
    }
  }

  createIndex(field) {
    if (this.indexes.has(field)) return;
    const indexMap = new Map();
    this.indexes.set(field, indexMap);

    // Populate existing docs
    for (const [id, doc] of this.documents.entries()) {
      const val = doc[field];
      if (val !== undefined && val !== null) {
        this.addIndexEntry(field, val, id);
      }
    }
  }

  addIndexEntry(field, value, id) {
    const indexMap = this.indexes.get(field);
    if (!indexMap) return;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (!indexMap.has(item)) indexMap.set(item, new Set());
        indexMap.get(item).add(id);
      }
    } else {
      if (!indexMap.has(value)) indexMap.set(value, new Set());
      indexMap.get(value).add(id);
    }
  }

  removeIndexEntry(field, value, id) {
    const indexMap = this.indexes.get(field);
    if (!indexMap) return;

    if (Array.isArray(value)) {
      for (const item of value) {
        const set = indexMap.get(item);
        if (set) {
          set.delete(id);
          if (set.size === 0) indexMap.delete(item);
        }
      }
    } else {
      const set = indexMap.get(value);
      if (set) {
        set.delete(id);
        if (set.size === 0) indexMap.delete(value);
      }
    }
  }

  insert(doc) {
    if (!doc.id) {
      throw new Error(`Document missing 'id' primary key`);
    }

    if (this.documents.has(doc.id)) {
      throw new Error(`Duplicate key error: document with id '${doc.id}' already exists`);
    }

    // Freeze document copy to prevent outside mutation
    const docCopy = JSON.parse(JSON.stringify(doc));
    this.documents.set(doc.id, docCopy);

    // Update indexes
    for (const field of this.indexes.keys()) {
      if (docCopy[field] !== undefined && docCopy[field] !== null) {
        this.addIndexEntry(field, docCopy[field], doc.id);
      }
    }

    return JSON.parse(JSON.stringify(docCopy));
  }

  findById(id) {
    const doc = this.documents.get(id);
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }

  update(id, partialDoc) {
    const existing = this.documents.get(id);
    if (!existing) {
      return null;
    }

    // Remove old index entries for modified fields
    for (const field of this.indexes.keys()) {
      if (partialDoc[field] !== undefined) {
        this.removeIndexEntry(field, existing[field], id);
      }
    }

    // Merge changes
    const updated = {
      ...existing,
      ...partialDoc,
      id, // Preserve id
      updatedAt: new Date().toISOString()
    };

    this.documents.set(id, updated);

    // Re-index updated fields
    for (const field of this.indexes.keys()) {
      if (updated[field] !== undefined && updated[field] !== null) {
        this.addIndexEntry(field, updated[field], id);
      }
    }

    return JSON.parse(JSON.stringify(updated));
  }

  delete(id) {
    const existing = this.documents.get(id);
    if (!existing) {
      return false;
    }

    // Remove index entries
    for (const field of this.indexes.keys()) {
      this.removeIndexEntry(field, existing[field], id);
    }

    return this.documents.delete(id);
  }

  truncate() {
    this.documents.clear();
    for (const indexMap of this.indexes.values()) {
      indexMap.clear();
    }
  }

  matchesFilter(doc, filter) {
    for (const [key, cond] of Object.entries(filter)) {
      const val = doc[key];

      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        // Operators
        if (cond.$eq !== undefined && val !== cond.$eq) return false;
        if (cond.$ne !== undefined && val === cond.$ne) return false;
        if (cond.$gt !== undefined && !(val > cond.$gt)) return false;
        if (cond.$gte !== undefined && !(val >= cond.$gte)) return false;
        if (cond.$lt !== undefined && !(val < cond.$lt)) return false;
        if (cond.$lte !== undefined && !(val <= cond.$lte)) return false;
        if (cond.$in !== undefined && (!Array.isArray(cond.$in) || !cond.$in.includes(val))) return false;
        if (cond.$nin !== undefined && Array.isArray(cond.$nin) && cond.$nin.includes(val)) return false;
        if (cond.$regex !== undefined) {
          const re = cond.$regex instanceof RegExp ? cond.$regex : new RegExp(cond.$regex, cond.$options || 'i');
          if (!re.test(String(val || ''))) return false;
        }
      } else if (Array.isArray(val)) {
        // If doc property is array, match if value is inside
        if (!val.includes(cond)) return false;
      } else {
        // Exact match
        if (val !== cond) return false;
      }
    }
    return true;
  }

  query(options = {}) {
    const {
      filter = {},
      sortBy = 'createdAt',
      sortOrder = 'desc',
      limit = 50,
      offset = 0
    } = options;

    let candidateIds = null;

    // Use index if filter has a simple equality condition on an indexed field
    for (const [key, val] of Object.entries(filter)) {
      if (this.indexes.has(key) && (typeof val === 'string' || typeof val === 'number')) {
        const idSet = this.indexes.get(key).get(val);
        candidateIds = idSet ? Array.from(idSet) : [];
        break;
      }
    }

    const matched = [];
    const sourceDocs = candidateIds
      ? candidateIds.map(id => this.documents.get(id)).filter(Boolean)
      : Array.from(this.documents.values());

    for (const doc of sourceDocs) {
      if (this.matchesFilter(doc, filter)) {
        matched.push(doc);
      }
    }

    // Sort
    if (sortBy) {
      matched.sort((a, b) => {
        const valA = a[sortBy];
        const valB = b[sortBy];
        if (valA === undefined && valB === undefined) return 0;
        if (valA === undefined) return 1;
        if (valB === undefined) return -1;

        if (typeof valA === 'string') {
          return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return sortOrder === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
      });
    }

    const total = matched.length;
    const paginated = matched.slice(offset, offset + limit);

    return {
      total,
      limit,
      offset,
      count: paginated.length,
      items: JSON.parse(JSON.stringify(paginated))
    };
  }

  getAll() {
    return Array.from(this.documents.values()).map(d => JSON.parse(JSON.stringify(d)));
  }

  loadState(docs) {
    this.truncate();
    for (const doc of docs) {
      this.insert(doc);
    }
  }
}

module.exports = Collection;
