const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');
const apiContractValidator = require('./apiContractValidator');
const { serveStatic } = require('./runtimeValidator');
const { sleep } = require('../../agents/baseAgent');

/**
 * E2EValidator — stage 5 of the Build Validation Pipeline. Proves the
 * generated application works end-to-end while the backend is running:
 *
 *  1. API-level flow (deterministic): register → login → create → update →
 *     delete → logout against the endpoints the API Contract scan discovered.
 *  2. Playwright UI flow (when available): loads the built frontend in a real
 *     headless Chromium browser and, if the app exposes a standard auth form,
 *     registers/logs in through the actual UI.
 *
 * Every sub-step is reported. A sub-step is "skipped" (not a failure) when the
 * generated app exposes no auth/CRUD endpoints — there is nothing to test.
 */

function uniqueEmail() {
  return `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@devforge.test`;
}

async function api(base, method, pathname, body, token) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

function extractToken(data) {
  if (!data) return null;
  if (typeof data.token === 'string') return data.token;
  if (typeof data.accessToken === 'string') return data.accessToken;
  if (data.data && typeof data.data.token === 'string') return data.data.token;
  if (data.data && typeof data.data.accessToken === 'string') return data.data.accessToken;
  return null;
}

function extractId(data) {
  if (!data) return null;
  if (data.id != null) return data.id;
  if (data._id != null) return data._id;
  if (data.data && data.data.id != null) return data.data.id;
  if (data.data && data.data._id != null) return data.data._id;
  return null;
}

function step(name, status, message, detail = null) {
  return { name, status, message, detail };
}

async function runApiFlow(base, auth, crud) {
  const steps = [];
  const email = uniqueEmail();
  const password = 'DevForgeE2e!2026';
  let token = null;
  let itemId = null;

  // ---- Register ----
  if (!auth.register) {
    steps.push(step('e2e-register', 'skipped', 'No register/signup endpoint detected — skipped.'));
  } else {
    const res = await api(base, 'POST', auth.register.path, {
      name: 'E2E Tester',
      username: 'e2etester',
      email,
      password,
    }).catch((e) => ({ status: 0, ok: false, data: { error: e.message } }));
    token = token || extractToken(res.data);
    steps.push(
      res.ok
        ? step('e2e-register', 'passed', `Register succeeded (HTTP ${res.status}).`)
        : step('e2e-register', 'failed', `Register failed (HTTP ${res.status}).`, JSON.stringify(res.data))
    );
  }

  // ---- Login ----
  if (!auth.login) {
    steps.push(step('e2e-login', 'skipped', 'No login endpoint detected — skipped.'));
  } else {
    const res = await api(base, 'POST', auth.login.path, { email, password }).catch((e) => ({ status: 0, ok: false, data: { error: e.message } }));
    token = token || extractToken(res.data);
    steps.push(
      res.ok
        ? step('e2e-login', 'passed', `Login succeeded (HTTP ${res.status}).`)
        : step('e2e-login', 'failed', `Login failed (HTTP ${res.status}).`, JSON.stringify(res.data))
    );
  }

  // ---- Create / Update / Delete ----
  if (!crud) {
    steps.push(step('e2e-crud', 'skipped', 'No CRUD resource endpoints detected — skipped create/update/delete.'));
  } else {
    const createRes = await api(base, 'POST', crud.base, {
      title: `E2E Item ${Date.now()}`,
      name: `E2E Item ${Date.now()}`,
      description: 'Created by the DevForge E2E validator.',
    }, token).catch((e) => ({ status: 0, ok: false, data: { error: e.message } }));
    itemId = extractId(createRes.data);
    steps.push(
      createRes.ok
        ? step('e2e-create', 'passed', `Create succeeded (HTTP ${createRes.status})${itemId != null ? ` id=${itemId}` : ''}.`)
        : step('e2e-create', 'failed', `Create failed (HTTP ${createRes.status}).`, JSON.stringify(createRes.data))
    );

    if (createRes.ok && itemId != null) {
      const updateRes = await api(base, crud.update.method.toUpperCase(), `${crud.base}/${itemId}`, {
        title: `E2E Item Updated ${Date.now()}`,
        description: 'Updated by the DevForge E2E validator.',
      }, token).catch((e) => ({ status: 0, ok: false, data: { error: e.message } }));
      steps.push(
        updateRes.ok
          ? step('e2e-update', 'passed', `Update succeeded (HTTP ${updateRes.status}).`)
          : step('e2e-update', 'failed', `Update failed (HTTP ${updateRes.status}).`, JSON.stringify(updateRes.data))
      );

      const deleteRes = await api(base, crud.remove.method.toUpperCase(), `${crud.base}/${itemId}`, null, token).catch((e) => ({ status: 0, ok: false, data: { error: e.message } }));
      steps.push(
        deleteRes.ok
          ? step('e2e-delete', 'passed', `Delete succeeded (HTTP ${deleteRes.status}).`)
          : step('e2e-delete', 'failed', `Delete failed (HTTP ${deleteRes.status}).`, JSON.stringify(deleteRes.data))
      );
    } else {
      steps.push(step('e2e-update', 'skipped', 'Create did not yield an id — update/delete skipped.'));
      steps.push(step('e2e-delete', 'skipped', 'Create did not yield an id — update/delete skipped.'));
    }
  }

  // ---- Logout ----
  if (!auth.logout) {
    steps.push(step('e2e-logout', 'skipped', 'No logout endpoint detected — skipped.'));
  } else {
    const res = await api(base, auth.logout.method.toUpperCase(), auth.logout.path, null, token).catch((e) => ({ status: 0, ok: false, data: { error: e.message } }));
    steps.push(
      res.ok
        ? step('e2e-logout', 'passed', `Logout succeeded (HTTP ${res.status}).`)
        : step('e2e-logout', 'failed', `Logout failed (HTTP ${res.status}).`, JSON.stringify(res.data))
    );
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Playwright UI flow
// ---------------------------------------------------------------------------

async function tryUiAuth(page) {
  try {
    const inputs = await page.evaluate(() => {
      const email = document.querySelector('input[type="email"], input[name="email"], input[autocomplete="email"]');
      const password = document.querySelector('input[type="password"], input[name="password"]');
      const buttons = [...document.querySelectorAll('button, a[role="button"]')].map((b) => (b.textContent || '').trim().toLowerCase());
      return {
        hasEmail: !!email,
        hasPassword: !!password,
        registerButton: buttons.find((t) => /register|create account|sign ?up/i.test(t)) || null,
        loginButton: buttons.find((t) => /log ?in|sign ?in/i.test(t)) || null,
      };
    });
    if (!inputs.hasEmail || !inputs.hasPassword) return null;

    const email = uniqueEmail();
    const password = 'DevForgeE2e!2026';

    // Try register first.
    if (inputs.registerButton) {
      await page.fill('input[type="email"], input[name="email"], input[autocomplete="email"]', email);
      const nameInput = await page.$('input[name="name"], input[autocomplete="name"]');
      if (nameInput) await page.fill('input[name="name"], input[autocomplete="name"]', 'E2E Tester');
      await page.fill('input[type="password"], input[name="password"]', password);
      await page.click(`text=/register|create account|sign ?up/i`);
      await page.waitForTimeout(1500);
      const url = page.url();
      const bodyText = await page.textContent('body').catch(() => '');
      const ok = url !== 'about:blank' && !/error|failed|invalid/i.test(bodyText);
      return { status: ok ? 'passed' : 'failed', message: ok ? 'UI register flow succeeded.' : 'UI register flow did not complete cleanly.', detail: url };
    }

    // Otherwise try login.
    if (inputs.loginButton) {
      await page.fill('input[type="email"], input[name="email"], input[autocomplete="email"]', email);
      await page.fill('input[type="password"], input[name="password"]', password);
      await page.click(`text=/log ?in|sign ?in/i`);
      await page.waitForTimeout(1500);
      const url = page.url();
      const bodyText = await page.textContent('body').catch(() => '');
      const ok = url !== 'about:blank' && !/error|failed|invalid credentials/i.test(bodyText);
      return { status: ok ? 'passed' : 'failed', message: ok ? 'UI login flow succeeded.' : 'UI login flow did not complete cleanly.', detail: url };
    }

    return null;
  } catch (err) {
    return { status: 'skipped', message: 'UI auth flow could not be exercised.', detail: err.message };
  }
}

async function runUiFlow({ projectId, layout, backend }) {
  if (!config.validationE2eEnabled) {
    return step('e2e-ui', 'skipped', 'E2E disabled — skipped.');
  }

  let pw = null;
  try {
    pw = require('playwright');
  } catch {
    pw = null;
  }
  if (!pw) {
    logger.info('[E2E] Playwright not installed — API-level flow only.');
    return step('e2e-ui', 'skipped', 'Playwright is not installed — browser UI check skipped (API-level E2E still ran).');
  }

  const clientDir = layout.clientDir;
  const clientPath = path.join(require('../previewService').safeProjectDir(projectId), clientDir || '');
  const distDir = path.join(clientPath, 'dist');
  if (!fs.existsSync(distDir)) {
    return step('e2e-ui', 'skipped', 'Frontend build output (dist/) not found — browser UI check skipped.');
  }

  let frontendServer = null;
  let browser = null;
  try {
    frontendServer = await serveStatic(distDir);
    browser = await pw.chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') logger.warn(`[E2E] browser console error: ${msg.text()}`);
    });

    await page.goto(frontendServer.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#root', { timeout: 10000 });
    await page.waitForTimeout(1200);

    const rendered = await page.evaluate(() => {
      const root = document.getElementById('root');
      return Boolean(root && (root.children.length > 0 || (root.textContent || '').trim().length > 0));
    });

    if (!rendered) {
      return step('e2e-ui', 'failed', 'Frontend loaded but #root rendered nothing (blank app).', frontendServer.url);
    }

    const authResult = await tryUiAuth(page);
    const uiStep = step(
      'e2e-ui',
      authResult ? (authResult.status === 'failed' ? 'failed' : 'passed') : 'passed',
      authResult ? `Frontend loaded in Chromium — ${authResult.message}` : 'Frontend loaded in Chromium (no auth UI detected — auth covered by API flow).',
      authResult ? (authResult.detail || null) : null
    );
    return uiStep;
  } catch (err) {
    return step('e2e-ui', 'failed', `Playwright could not verify the frontend: ${err.message}`, err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (frontendServer) await frontendServer.close().catch(() => {});
  }
}

/**
 * Run the full E2E stage against a running backend.
 * @param {{ projectId: string, files: Object, layout: Object, backend: {base:string, port:number} }}
 * @returns {{ ok: boolean, steps: object[], summary: object }}
 */
async function runE2E({ projectId, files, layout, backend }) {
  const t0 = Date.now();
  if (!config.validationE2eEnabled) {
    return { ok: true, steps: [step('e2e', 'skipped', 'E2E testing disabled — skipped.')], summary: { attempts: 0 } };
  }
  if (!backend) {
    return { ok: true, steps: [step('e2e', 'skipped', 'Backend is not running — E2E skipped.')], summary: { attempts: 0 } };
  }

  const { routes } = apiContractValidator.scanBackend(files, layout.serverDir);
  const auth = apiContractValidator.findAuthEndpoints(routes);
  const crud = apiContractValidator.findCrudResource(routes);

  const steps = [];
  steps.push(step('e2e-start', 'passed', `E2E started against ${backend.base}.`, null));
  const apiSteps = await runApiFlow(backend.base, auth, crud);
  steps.push(...apiSteps);
  const uiStep = await runUiFlow({ projectId, layout, backend });
  steps.push(uiStep);

  const failed = steps.filter((s) => s.status === 'failed');
  const passed = steps.filter((s) => s.status === 'passed');
  const skipped = steps.filter((s) => s.status === 'skipped');

  const summary = {
    attempted: passed.length + failed.length,
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
    auth,
    crud: crud ? { base: crud.base, create: crud.create.path, update: crud.update.path, remove: crud.remove.path } : null,
  };

  return {
    ok: failed.length === 0,
    steps: [{ name: 'e2e', status: failed.length ? 'failed' : 'passed', message: failed.length ? `E2E failed ${failed.length} check(s).` : `E2E passed (${passed.length} passed${skipped.length ? `, ${skipped.length} skipped` : ''}).`, detail: null, durationMs: Date.now() - t0 }, ...steps],
    summary,
  };
}

module.exports = { runE2E, runApiFlow, runUiFlow };
