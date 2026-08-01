const { isConfigured, getModel } = require('../services/openrouterService');

async function status(req, res) {
  res.json({ configured: isConfigured(), model: getModel() });
}

module.exports = { status };
