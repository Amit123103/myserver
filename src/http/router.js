'use strict';

/**
 * Custom Zero-Dependency HTTP Router
 * Supports method + path matching, path parameters (:param), query parsing, and route docs registry.
 */

class Router {
  constructor() {
    this.routes = [];
    this.docs = []; // Route documentation metadata
  }

  register(method, pathPattern, handler, options = {}) {
    const paramNames = [];
    // Convert path with :params into regex
    // e.g. /api/v1/notes/:id -> ^\/api\/v1\/notes\/([^/]+)$
    const regexPattern = pathPattern
      .replace(/:([a-zA-Z0-9_]+)/g, (_, paramName) => {
        paramNames.push(paramName);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/');

    const regex = new RegExp(`^${regexPattern}$`);

    const routeEntry = {
      method: method.toUpperCase(),
      pathPattern,
      regex,
      paramNames,
      handler,
      middlewares: options.middlewares || [],
      meta: {
        summary: options.summary || '',
        description: options.description || '',
        auth: options.auth !== false, // Protected by default
        tags: options.tags || ['General'],
        params: paramNames,
        requestBody: options.requestBody || null,
        responses: options.responses || {}
      }
    };

    this.routes.push(routeEntry);
    this.docs.push({
      method: routeEntry.method,
      path: pathPattern,
      ...routeEntry.meta
    });

    return this;
  }

  get(path, handler, options) {
    return this.register('GET', path, handler, options);
  }

  post(path, handler, options) {
    return this.register('POST', path, handler, options);
  }

  put(path, handler, options) {
    return this.register('PUT', path, handler, options);
  }

  delete(path, handler, options) {
    return this.register('DELETE', path, handler, options);
  }

  patch(path, handler, options) {
    return this.register('PATCH', path, handler, options);
  }

  options(path, handler, options) {
    return this.register('OPTIONS', path, handler, options);
  }

  parseQuery(url) {
    const qIndex = url.indexOf('?');
    if (qIndex === -1) return {};

    const queryString = url.substring(qIndex + 1);
    const params = {};
    const pairs = queryString.split('&');

    for (const pair of pairs) {
      if (!pair) continue;
      const [key, val] = pair.split('=');
      const decodedKey = decodeURIComponent(key);
      const decodedVal = val !== undefined ? decodeURIComponent(val.replace(/\+/g, ' ')) : true;

      // Handle numerical values
      if (typeof decodedVal === 'string' && /^-?\d+$/.test(decodedVal)) {
        params[decodedKey] = parseInt(decodedVal, 10);
      } else {
        params[decodedKey] = decodedVal;
      }
    }

    return params;
  }

  match(method, pathname) {
    const upperMethod = method.toUpperCase();

    for (const route of this.routes) {
      if (route.method !== upperMethod) continue;

      const match = pathname.match(route.regex);
      if (match) {
        const params = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
        }

        return {
          route,
          params,
          handler: route.handler,
          middlewares: route.middlewares
        };
      }
    }

    return null;
  }
}

module.exports = Router;
