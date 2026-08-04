const AdmZip = require('adm-zip');
const prisma = require('../lib/prisma');
const deploymentService = require('../services/deploymentService');
const { requireOwnedProject } = require('../utils/projectAccess');
const { slugify } = require('../utils/fileUtils');

async function loadFileMap(projectId) {
  const files = await prisma.projectFile.findMany({
    where: { projectId },
    select: { path: true, content: true },
  });
  const fileMap = {};
  for (const f of files) fileMap[f.path] = f.content;
  return fileMap;
}

/** Generate (on demand) the production deployment bundle for a project. */
async function getDeployment(req, res) {
  const { id } = req.params;
  const project = await requireOwnedProject(id, req.userId);
  const fileMap = await loadFileMap(id);
  const result = deploymentService.generate(fileMap, { title: project.title });
  res.json(result);
}

/** Download the deployment bundle as a ready-to-use ZIP. */
async function exportDeployment(req, res) {
  const { id } = req.params;
  const project = await requireOwnedProject(id, req.userId);
  const fileMap = await loadFileMap(id);
  const result = deploymentService.generate(fileMap, { title: project.title });

  const zip = new AdmZip();
  for (const f of result.files) {
    zip.addFile(f.path.replace(/\\/g, '/'), Buffer.from(f.content, 'utf8'));
  }
  const buffer = zip.toBuffer();
  const slug = slugify(project.title);

  await prisma.download
    .create({ data: { projectId: id, userId: req.userId, kind: 'deployment-zip', size: buffer.length } })
    .catch(() => {});

  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${slug}-deployment.zip"`,
    'Content-Length': buffer.length,
  });
  res.send(buffer);
}

module.exports = { getDeployment, exportDeployment };
