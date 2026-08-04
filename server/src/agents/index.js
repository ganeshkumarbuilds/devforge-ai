const ProductManagerAgent = require('./productManager');
const ArchitectAgent = require('./architect');
const DatabaseEngineerAgent = require('./databaseEngineer');
const BackendEngineerAgent = require('./backendEngineer');
const FrontendEngineerAgent = require('./frontendEngineer');
const QAEngineerAgent = require('./qaEngineer');
const DeploymentEngineerAgent = require('./deploymentEngineer');
const DocumentationEngineerAgent = require('./documentationEngineer');

function createAgents() {
  return [
    new ProductManagerAgent(),
    new ArchitectAgent(),
    new DatabaseEngineerAgent(),
    new BackendEngineerAgent(),
    new FrontendEngineerAgent(),
    new QAEngineerAgent(),
    new DeploymentEngineerAgent(),
    new DocumentationEngineerAgent(),
  ];
}

module.exports = { createAgents };
