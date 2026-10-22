'use strict';

/**
 * Custom Response Helpers
 * Extends Node's http.ServerResponse with clean, safe JSON response methods.
 */

const config = require('../config');

function attachResponseHelpers(req, res) {
  res.json = function(statusCode, payload) {
    const jsonString = JSON.stringify(payload);
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    // Content-Length can be handled or let gzip handle it
    if (!res.getHeader('Content-Encoding')) {
      res.setHeader('Content-Length', Buffer.byteLength(jsonString, 'utf8'));
    }

    res.end(jsonString);
  };

  res.success = function(data, message = 'Success', statusCode = 200, meta = null) {
    res.json(statusCode, {
      success: true,
      message,
      data,
      ...(meta ? { meta } : {})
    });
  };

  res.error = function(statusCode, message, errorCode = 'ERROR', errors = null) {
    res.json(statusCode, {
      success: false,
      error: {
        code: errorCode,
        message,
        ...(errors ? { details: errors } : {})
      }
    });
  };

  res.sendHtml = function(statusCode, html) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(html, 'utf8'));
    res.end(html);
  };
}

module.exports = {
  attachResponseHelpers
};
