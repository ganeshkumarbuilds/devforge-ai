const http = require('http');
const prisma = require('./src/lib/prisma');

const BASE = 'http://localhost:5000/api';
let token = '';
let projectId = '';
let v1 = '';
let v2 = '';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(`${BASE}${path}`, { method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, data: j });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const assert = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg);
  if (!cond) process.exitCode = 1;
};

(async () => {
  const suffix = Date.now();

  const reg = await req('POST', '/api/auth/register', {
    name: 'VerTester', email: `ver_${suffix}@test.com`, password: 'pass12345',
  });
  token = reg.data && reg.data.token;
  assert(!!token, `register returns token (${reg.status})`);

  const user = await prisma.user.findUnique({ where: { email: `ver_${suffix}@test.com` } });

  const project = await prisma.project.create({
    data: {
      title: 'Versioning Demo', description: 'Build a demo app', stack: 'Auto', status: 'completed', ownerId: user.id,
    },
  });
  projectId = project.id;
  await prisma.projectFile.createMany({
    data: [
      { projectId, path: 'server/index.js', content: 'const app = require("express")();', language: 'javascript' },
      { projectId, path: 'README.md', content: '# Demo', language: 'markdown' },
      { projectId, path: 'prisma/schema.prisma', content: 'model User {\n  id Int @id\n}\n', language: 'text' },
    ],
  });
  console.log('seeded project ' + projectId);

  let r = await req('POST', `/api/projects/${projectId}/versions`, { notes: 'initial snapshot' });
  assert(r.status === 201 && r.data.version && r.data.version.version === 'v1', `createManual v1 (${r.status})`);
  v1 = r.data.version.id;

  r = await req('POST', `/api/projects/${projectId}/versions`, { notes: 'second snapshot' });
  assert(r.status === 201 && r.data.version.version === 'v2', `createManual v2 (${r.status})`);
  v2 = r.data.version.id;

  r = await req('GET', `/api/projects/${projectId}/versions`);
  assert(r.status === 200 && Array.isArray(r.data.versions) && r.data.versions.length === 2, `list versions (${r.status})`);
  assert(r.data.versions[0].prompt && r.data.versions[0].createdAt && r.data.versions[0].fileCount === 3, 'version has prompt/timestamp/fileCount');

  r = await req('GET', `/api/projects/${projectId}/versions/${v1}`);
  assert(r.status === 200 && r.data.version.files.length === 3 && !r.data.version.files[0].content, 'getVersion without content leak');

  // mutate project files, then restore v1
  await prisma.projectFile.create({ data: { projectId, path: 'extra.txt', content: 'x', language: 'text' } });
  await prisma.projectFile.deleteMany({ where: { projectId, path: 'README.md' } });

  r = await req('POST', `/api/projects/${projectId}/versions/${v1}/restore`);
  assert(r.status === 200 && r.data.ok === true && r.data.files === 3, `restore v1 (${r.status})`);

  const filesAfter = await prisma.projectFile.findMany({ where: { projectId }, select: { path: true } });
  assert(filesAfter.length === 3 && !filesAfter.some((f) => f.path === 'extra.txt') && filesAfter.some((f) => f.path === 'README.md'), 'restore rewrote files correctly');

  r = await req('GET', `/api/projects/${projectId}/versions/${v1}/diff/${v2}`);
  assert(r.status === 200 && r.data.stats && Array.isArray(r.data.changes), `diff v1..v2 (${r.status})`);
  if (r.data.stats) console.log('   diff stats:', JSON.stringify(r.data.stats));

  r = await req('GET', `/api/projects/${projectId}/versions/${v1}/migration`);
  console.log('   migration status:', r.status, r.status === 200 ? r.data.filename : JSON.stringify(r.data).slice(0, 120));

  r = await req('GET', `/api/projects/${projectId}/versions/nope`);
  assert(r.status === 404, `missing version -> 404 (${r.status})`);

  r = await req('GET', '/api/projects/does-not-exist/versions');
  assert(r.status === 404, `foreign/missing project -> 404 (${r.status})`);

  await prisma.project.delete({ where: { id: projectId } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log('cleanup done');
})().catch((e) => { console.error('ERROR', e); process.exit(1); });