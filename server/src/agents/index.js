const ProductManagerAgent = require('./productManager');
const ArchitectAgent = require('./architect');
const DatabaseEngineerAgent = require('./databaseEngineer');
const BackendEngineerAgent = require('./backendEngineer');
const FrontendEngineerAgent = require('./frontendEngineer');
const QAEngineerAgent = require('./qaEngineer');
const DocumentationEngineerAgent = require('./documentationEngineer');
const DeploymentEngineerAgent = require('./deploymentEngineer');

function createAgents() {
  return [
    new ProductManagerAgent(),
    new ArchitectAgent(),
    new DatabaseEngineerAgent(),
    new BackendEngineerAgent(),
    new FrontendEngineerAgent(),
    new QAEngineerAgent(),
    new DocumentationEngineerAgent(),
    new DeploymentEngineerAgent(),
  ];
}

module.exports = { createAgents };
