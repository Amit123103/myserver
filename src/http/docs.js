'use strict';

/**
 * Custom Zero-Dependency API Documentation Generator
 * Serves interactive OpenAPI/Swagger-like web documentation at /docs.
 */

function renderDocsHtml(router, domain, port) {
  const hostStr = port === 443 || port === 80 ? domain : `${domain}:${port}`;
  const baseUrl = `https://${hostStr}`;

  const methodColors = {
    GET: '#10b981',
    POST: '#3b82f6',
    PUT: '#f59e0b',
    DELETE: '#ef4444',
    PATCH: '#8b5cf6'
  };

  const routesHtml = router.docs.map(route => {
    const color = methodColors[route.method] || '#6b7280';
    const authBadge = route.auth
      ? `<span class="badge auth-badge">🔒 Requires x-api-key</span>`
      : `<span class="badge public-badge">🌐 Public</span>`;

    const curlExample = route.auth
      ? `curl -k -X ${route.method} "${baseUrl}${route.path.replace(/:([a-zA-Z0-9_]+)/g, '123')}" \\\n  -H "x-api-key: YOUR_API_KEY"${route.method === 'POST' || route.method === 'PUT' ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"My Note","content":"Walkthrough"}'` : ''}`
      : `curl -k "${baseUrl}${route.path}"`;

    let bodySection = '';
    if (route.requestBody) {
      bodySection = `
        <div class="schema-box">
          <h4>Request Body (JSON)</h4>
          <pre><code>${JSON.stringify(route.requestBody, null, 2)}</code></pre>
        </div>
      `;
    }

    return `
      <div class="card route-card" id="${route.method.toLowerCase()}-${route.path.replace(/[^a-zA-Z0-9]/g, '-')}">
        <div class="route-header">
          <span class="method-tag" style="background-color: ${color};">${route.method}</span>
          <span class="route-path">${route.path}</span>
          ${authBadge}
        </div>
        <div class="route-body">
          <p class="summary">${route.summary || 'No summary provided.'}</p>
          ${route.description ? `<p class="description">${route.description}</p>` : ''}

          ${bodySection}

          <div class="curl-box">
            <div class="curl-header">
              <span>Example cURL Command</span>
              <button class="copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText)">Copy</button>
            </div>
            <pre><code>${curlExample}</code></pre>
          </div>
        </div>
      </div>
    `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>myserver API Documentation</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --border: #334155;
      --accent: #38bdf8;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font);
      line-height: 1.6;
      padding: 2rem 1rem;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    header {
      margin-bottom: 2.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
    }
    h1 { font-size: 2.2rem; color: #fff; margin-bottom: 0.5rem; }
    .subtitle { color: var(--text-muted); font-size: 1rem; }
    .badge-bar { margin-top: 1rem; display: flex; gap: 0.75rem; flex-wrap: wrap; }
    .badge {
      font-size: 0.8rem;
      font-weight: 600;
      padding: 0.25rem 0.6rem;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
    }
    .auth-badge { background: #451a03; color: #fbbf24; border: 1px solid #78350f; }
    .public-badge { background: #064e3b; color: #34d399; border: 1px solid #065f46; }
    .zero-badge { background: #1e1b4b; color: #a5b4fc; border: 1px solid #3730a3; }

    .route-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 1.5rem;
      overflow: hidden;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .route-card:hover { border-color: var(--accent); }
    .route-header {
      padding: 1rem 1.25rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      background: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .method-tag {
      color: #fff;
      font-size: 0.85rem;
      font-weight: 700;
      padding: 0.25rem 0.7rem;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }
    .route-path { font-family: monospace; font-size: 1.1rem; font-weight: 600; color: #fff; }
    .route-body { padding: 1.25rem; }
    .summary { font-size: 1rem; font-weight: 500; margin-bottom: 0.5rem; color: #e2e8f0; }
    .description { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1rem; }
    
    pre {
      background: #090d16;
      border: 1px solid var(--border);
      padding: 0.85rem;
      border-radius: 6px;
      overflow-x: auto;
      font-family: monospace;
      font-size: 0.85rem;
      color: #38bdf8;
    }
    .schema-box { margin-bottom: 1rem; }
    .schema-box h4 { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.4rem; text-transform: uppercase; }
    
    .curl-box { margin-top: 1rem; }
    .curl-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.3rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .copy-btn {
      background: #334155;
      color: #fff;
      border: none;
      padding: 0.2rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
    }
    .copy-btn:hover { background: #475569; }

    footer {
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>myserver API v1</h1>
      <p class="subtitle">Complete Zero-Dependency Self-Hosted REST API & Durability Engine</p>
      <div class="badge-bar">
        <span class="badge zero-badge">⚡ Pure Node.js Standard Library (0 Dependencies)</span>
        <span class="badge auth-badge">🔒 Header: x-api-key</span>
        <span class="badge public-badge">🛡️ TLS / HTTPS Active</span>
      </div>
    </header>

    <main>
      ${routesHtml}
    </main>

    <footer>
      <p>myserver &bull; Self-Hosted Production-Ready API &bull; Running on Node.js ${process.version}</p>
    </footer>
  </div>
</body>
</html>`;
}

module.exports = {
  renderDocsHtml
};
