'use strict';

/**
 * myserver Dashboard — Client-Side Application
 * Zero-dependency interactive control panel with live health polling and project management.
 */

(function() {

  // ========== State ==========
  let apiKey = localStorage.getItem('myserver_api_key') || '';
  let refreshTimer = null;

  // ========== Helpers ==========
  async function apiRequest(method, path, body = null, customKey = null) {
    const headers = { 'Content-Type': 'application/json' };
    const key = customKey || apiKey;
    if (key) headers['x-api-key'] = key;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(path, opts);
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  }

  function formatUptime(seconds) {
    if (!seconds && seconds !== 0) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(d + 'd');
    if (h > 0) parts.push(h + 'h');
    if (m > 0) parts.push(m + 'm');
    parts.push(s + 's');
    return parts.join(' ');
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (_) {
      return iso;
    }
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  // ========== Health Check ==========
  async function refreshHealth() {
    try {
      const { ok, data } = await apiRequest('GET', '/health');
      const statusDot = $('.status-dot');
      const statusText = $('.status-text');
      const d = data && data.data ? data.data : {};

      if (ok && d.status === 'UP') {
        statusDot.className = 'status-dot online';
        statusText.textContent = 'Online';
        $('#health-status').textContent = 'Healthy';
        $('#health-status').style.color = '#10b981';
      } else {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'Degraded';
        $('#health-status').textContent = d.status || 'Error';
        $('#health-status').style.color = '#f59e0b';
      }

      $('#uptime-value').textContent = formatUptime(d.uptimeSeconds);
      $('#memory-value').textContent = d.memory ? d.memory.rssMb + ' MB' : '—';
      $('#notes-count').textContent = d.services ? d.services.totalNotes : '—';
      $('#node-version').textContent = d.nodeVersion || '';

    } catch (err) {
      $('.status-dot').className = 'status-dot offline';
      $('.status-text').textContent = 'Offline';
      $('#health-status').textContent = 'Unreachable';
      $('#health-status').style.color = '#ef4444';
    }
  }

  // ========== Projects ==========
  function renderProjectCard(p) {
    const url = p.url || `/projects/${p.slug}/`;
    const fullUrl = p.fullUrl || url;
    const created = formatDate(p.createdAt);

    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-name">${escapeHtml(p.name || p.slug)}</div>
      <div class="project-desc">${escapeHtml(p.description || '')}</div>
      <a class="project-url" href="${url}" target="_blank">🔗 ${url}</a>
      <div class="project-meta">
        <span class="project-date">${created}</span>
        <div class="project-actions">
          <a href="${url}" target="_blank" class="btn-icon" title="Open">↗</a>
          <button class="btn-icon delete-project-btn" data-slug="${escapeHtml(p.slug)}" title="Delete">🗑</button>
        </div>
      </div>
    `;
    return card;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function loadProjects() {
    const grid = $('#projects-grid');
    const empty = $('#empty-projects');

    try {
      const { ok, data } = await apiRequest('GET', '/api/v1/projects');
      const projects = ok && data && data.data ? data.data : [];

      grid.innerHTML = '';
      if (projects.length === 0) {
        grid.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📦</div>
            <h3>No Projects Deployed Yet</h3>
            <p>Click "Deploy New Project" or copy files to <code>./public/projects/your-app/</code></p>
          </div>`;
        return;
      }

      for (const p of projects) {
        grid.appendChild(renderProjectCard(p));
      }

      // Attach delete handlers
      $$('.delete-project-btn').forEach(btn => {
        btn.addEventListener('click', async function() {
          const slug = this.dataset.slug;
          if (!confirm('Delete project "' + slug + '"? This removes all files.')) return;
          if (!apiKey) {
            apiKey = prompt('Enter your API key (sk_...)');
            if (!apiKey) return;
            localStorage.setItem('myserver_api_key', apiKey);
          }
          const res = await apiRequest('DELETE', '/api/v1/projects/' + slug);
          if (res.ok) {
            loadProjects();
          } else {
            alert('Delete failed: ' + (res.data && res.data.error ? res.data.error.message : 'Unknown error'));
          }
        });
      });

    } catch (err) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Could not load projects</h3><p>${err.message}</p></div>`;
    }
  }

  // ========== Deploy Modal ==========
  function openModal() {
    $('#deploy-modal').style.display = 'flex';
    $('#deploy-result').style.display = 'none';
    $('#project-name').focus();
  }

  function closeModal() {
    $('#deploy-modal').style.display = 'none';
    // Reset form
    $('#project-name').value = '';
    $('#project-slug').value = '';
    $('#project-desc').value = '';
    $('#project-html').value = '';
    $('#project-css').value = '';
    $('#project-js').value = '';
    $('#deploy-result').style.display = 'none';
  }

  // Auto-slug from project name
  function nameToSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  async function submitDeploy() {
    const name = $('#project-name').value.trim();
    const slug = $('#project-slug').value.trim() || nameToSlug(name);
    const desc = $('#project-desc').value.trim();
    const html = $('#project-html').value.trim();
    const css = $('#project-css').value.trim();
    const js = $('#project-js').value.trim();
    const key = $('#api-key-input').value.trim();
    const resultDiv = $('#deploy-result');

    if (!name) {
      resultDiv.className = 'deploy-result error';
      resultDiv.textContent = 'Project name is required.';
      resultDiv.style.display = 'block';
      return;
    }

    if (!key) {
      resultDiv.className = 'deploy-result error';
      resultDiv.textContent = 'API key is required. Generate one with: node cli/keys.js create "Name"';
      resultDiv.style.display = 'block';
      return;
    }

    // Save API key for future use
    apiKey = key;
    localStorage.setItem('myserver_api_key', key);

    const body = { name, slug, description: desc || undefined };
    if (html) body.html = html;
    if (css) body.css = css;
    if (js) body.js = js;

    try {
      const res = await apiRequest('POST', '/api/v1/projects/deploy', body, key);

      if (res.ok) {
        const d = res.data.data;
        resultDiv.className = 'deploy-result success';
        resultDiv.innerHTML = `✅ Deployed successfully! <a href="${d.url}" target="_blank">Open ${d.url}</a>`;
        resultDiv.style.display = 'block';
        loadProjects();
      } else {
        const msg = res.data && res.data.error ? res.data.error.message : 'Deploy failed';
        resultDiv.className = 'deploy-result error';
        resultDiv.textContent = '❌ ' + msg;
        resultDiv.style.display = 'block';
      }
    } catch (err) {
      resultDiv.className = 'deploy-result error';
      resultDiv.textContent = '❌ Network error: ' + err.message;
      resultDiv.style.display = 'block';
    }
  }

  // ========== Init ==========
  function init() {
    // Bind modal events
    $('#btn-deploy-new').addEventListener('click', openModal);
    $('#modal-close').addEventListener('click', closeModal);
    $('#btn-cancel').addEventListener('click', closeModal);
    $('#btn-submit-deploy').addEventListener('click', submitDeploy);

    // Close modal on escape or overlay click
    $('#deploy-modal').addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeModal();
    });

    // Auto slug preview
    $('#project-name').addEventListener('input', function() {
      const slug = nameToSlug(this.value);
      $('#slug-preview').textContent = slug || '...';
      if (!$('#project-slug').value) {
        // Don't overwrite manual slug
      }
    });

    // Pre-fill API key if stored
    if (apiKey) {
      $('#api-key-input').value = apiKey;
    }

    // Initial data load
    refreshHealth();
    loadProjects();

    // Refresh health every 15 seconds
    refreshTimer = setInterval(refreshHealth, 15000);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
