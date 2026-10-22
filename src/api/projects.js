'use strict';

/**
 * Project Deployment & Hosting Manager
 * Allows deploying web apps, landing pages, and frontend projects to ./public/projects/
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDatabase } = require('../db/engine');

const PROJECTS_DIR = path.resolve(config.paths.root, 'public/projects');

function ensureProjectsDir() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  }
}

function registerProjectRoutes(router) {
  ensureProjectsDir();
  const db = getDatabase();

  // Ensure 'projects' collection exists
  let col = null;
  try {
    col = db.getCollection('projects');
  } catch (_) {
    col = db.registerSchema('projects', null, ['slug']);
  }

  // 1. List all deployed projects
  router.get('/api/v1/projects', (req, res) => {
    ensureProjectsDir();
    const stored = col.getAll();
    const diskDirs = fs.readdirSync(PROJECTS_DIR).filter(f => {
      return fs.statSync(path.join(PROJECTS_DIR, f)).isDirectory();
    });

    // Merge disk projects
    const allProjects = [];
    const seenSlugs = new Set();

    for (const p of stored) {
      seenSlugs.add(p.slug);
      allProjects.push({
        ...p,
        url: `/projects/${p.slug}/`,
        fullUrl: `https://${config.domain}/projects/${p.slug}/`
      });
    }

    for (const dir of diskDirs) {
      if (!seenSlugs.has(dir)) {
        const fullDir = path.join(PROJECTS_DIR, dir);
        allProjects.push({
          id: `disk-${dir}`,
          name: dir.replace(/[-_]/g, ' '),
          slug: dir,
          description: 'Deployed directly to disk folder',
          url: `/projects/${dir}/`,
          fullUrl: `https://${config.domain}/projects/${dir}/`,
          createdAt: fs.statSync(fullDir).birthtime.toISOString()
        });
      }
    }

    res.success(allProjects, 'Projects listed successfully');
  }, {
    summary: 'List deployed projects',
    description: 'Returns all web projects and applications deployed on this server.',
    tags: ['Projects'],
    auth: false
  });

  // 2. Deploy a new project via API
  router.post('/api/v1/projects/deploy', (req, res) => {
    ensureProjectsDir();
    const { name, slug, html, css, js, description } = req.body || {};

    if (!name || typeof name !== 'string') {
      return res.error(400, "Project 'name' is required", 'INVALID_NAME');
    }

    const cleanSlug = (slug || name)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!cleanSlug) {
      return res.error(400, 'Invalid project slug', 'INVALID_SLUG');
    }

    const projectDir = path.join(PROJECTS_DIR, cleanSlug);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    // Default HTML if none provided
    const finalHtml = html || `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>🚀 Welcome to ${name}</h1>
    <p>This project is self-hosted on your own computer with <strong>myserver</strong>.</p>
    <div id="app"></div>
  </div>
  <script src="app.js"></script>
</body>
</html>`;

    const finalCss = css || `
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0f172a;
  color: #f8fafc;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}
.container {
  text-align: center;
  background: #1e293b;
  padding: 3rem;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.5);
  border: 1px solid #334155;
  max-width: 600px;
}
h1 { color: #38bdf8; margin-bottom: 1rem; }
p { color: #94a3b8; line-height: 1.6; }
`;

    const finalJs = js || `
console.log('App "${name}" initialized on myserver!');
document.getElementById('app').innerHTML = '<p style="color:#10b981;margin-top:1.5rem;">✔ Live & Operational</p>';
`;

    fs.writeFileSync(path.join(projectDir, 'index.html'), finalHtml, 'utf8');
    fs.writeFileSync(path.join(projectDir, 'style.css'), finalCss, 'utf8');
    fs.writeFileSync(path.join(projectDir, 'app.js'), finalJs, 'utf8');

    // Save project record in DB
    const existing = col.query({ filter: { slug: cleanSlug } }).items[0];
    let projectDoc = null;

    if (existing) {
      projectDoc = db.update('projects', existing.id, {
        name,
        description: description || 'Self-hosted web application',
        updatedAt: new Date().toISOString()
      });
    } else {
      projectDoc = db.insert('projects', {
        name,
        slug: cleanSlug,
        description: description || 'Self-hosted web application',
        createdAt: new Date().toISOString()
      });
    }

    const result = {
      ...projectDoc,
      url: `/projects/${cleanSlug}/`,
      fullUrl: `https://${config.domain}/projects/${cleanSlug}/`,
      folderPath: projectDir
    };

    res.success(result, `Project '${name}' deployed successfully!`, 201);
  }, {
    summary: 'Deploy web project',
    description: 'Deploys a custom web project with HTML, CSS, and JS into ./public/projects/<slug>/',
    tags: ['Projects']
  });

  // 3. Delete a deployed project
  router.delete('/api/v1/projects/:slug', (req, res) => {
    ensureProjectsDir();
    const slug = req.params.slug;
    const projectDir = path.join(PROJECTS_DIR, slug);

    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }

    const record = col.query({ filter: { slug } }).items[0];
    if (record) {
      db.delete('projects', record.id);
    }

    res.success({ slug }, `Project '${slug}' deleted.`);
  }, {
    summary: 'Delete deployed project',
    description: 'Removes the project directory and metadata record.',
    tags: ['Projects']
  });
}

module.exports = {
  PROJECTS_DIR,
  ensureProjectsDir,
  registerProjectRoutes
};
