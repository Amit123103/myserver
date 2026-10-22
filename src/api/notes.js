'use strict';

/**
 * Notes & Tasks CRUD REST Endpoints
 * Routes under /api/v1/notes
 */

const { getDatabase } = require('../db/engine');

function registerNotesRoutes(router) {
  const db = getDatabase();

  // 1. List notes with filtering, pagination, and sorting
  router.get('/api/v1/notes', (req, res) => {
    const query = req.query || {};
    const filter = {};

    if (query.status) {
      filter.status = query.status;
    }
    if (query.priority) {
      filter.priority = query.priority;
    }
    if (query.tag) {
      filter.tags = query.tag;
    }
    if (query.q) {
      // Free text search in title or content
      filter.title = { $regex: query.q, $options: 'i' };
    }

    const limit = Math.min(Math.max(parseInt(query.limit || '20', 10), 1), 100);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const result = db.query('notes', {
      filter,
      limit,
      offset,
      sortBy,
      sortOrder
    });

    res.success(result.items, 'Notes retrieved successfully', 200, {
      total: result.total,
      count: result.count,
      limit: result.limit,
      offset: result.offset
    });
  }, {
    summary: 'List and filter notes',
    description: 'Retrieve a paginated list of notes with optional filters for status, priority, tags, and text search.',
    tags: ['Notes'],
    responses: {
      200: 'List of notes with pagination metadata',
      401: 'Unauthorized - invalid or missing x-api-key'
    }
  });

  // 2. Aggregate statistics for notes
  router.get('/api/v1/notes/stats', (req, res) => {
    const all = db.getCollection('notes').getAll();

    const stats = {
      total: all.length,
      byStatus: { todo: 0, in_progress: 0, completed: 0, archived: 0 },
      byPriority: { low: 0, medium: 0, high: 0, urgent: 0 }
    };

    for (const note of all) {
      if (stats.byStatus[note.status] !== undefined) {
        stats.byStatus[note.status]++;
      }
      if (stats.byPriority[note.priority] !== undefined) {
        stats.byPriority[note.priority]++;
      }
    }

    res.success(stats, 'Notes statistics computed');
  }, {
    summary: 'Notes summary statistics',
    description: 'Get counts of notes grouped by status and priority.',
    tags: ['Notes']
  });

  // 3. Get single note by ID
  router.get('/api/v1/notes/:id', (req, res) => {
    const note = db.findById('notes', req.params.id);
    if (!note) {
      return res.error(404, `Note with ID '${req.params.id}' not found`, 'NOT_FOUND');
    }
    res.success(note, 'Note retrieved successfully');
  }, {
    summary: 'Get note by ID',
    description: 'Fetch details for a single note by its UUID.',
    tags: ['Notes'],
    params: ['id']
  });

  // 4. Create new note
  router.post('/api/v1/notes', (req, res) => {
    const newNote = db.insert('notes', req.body);
    res.success(newNote, 'Note created successfully', 201);
  }, {
    summary: 'Create a new note',
    description: 'Insert a new note record. Validates schema and appends to Write-Ahead Log.',
    tags: ['Notes'],
    requestBody: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        content: { type: 'string', maxLength: 50000 },
        status: { type: 'string', enum: ['todo', 'in_progress', 'completed', 'archived'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        tags: { type: 'array', items: { type: 'string' } }
      }
    }
  });

  // 5. Update existing note
  router.put('/api/v1/notes/:id', (req, res) => {
    const updated = db.update('notes', req.params.id, req.body);
    res.success(updated, 'Note updated successfully');
  }, {
    summary: 'Update an existing note',
    description: 'Modify fields of an existing note by ID.',
    tags: ['Notes'],
    params: ['id']
  });

  // 6. Delete note
  router.delete('/api/v1/notes/:id', (req, res) => {
    db.delete('notes', req.params.id);
    res.success({ id: req.params.id }, 'Note deleted successfully');
  }, {
    summary: 'Delete a note',
    description: 'Permanently removes a note record and logs removal to WAL.',
    tags: ['Notes'],
    params: ['id']
  });
}

module.exports = {
  registerNotesRoutes
};
