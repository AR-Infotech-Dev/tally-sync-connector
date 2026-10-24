export const activateConnector = (payload) => window.connector.activateConnector(payload);
export const saveOnboarding = (config) => window.connector.saveConfig(config);
export const testTally = () => window.connector.testTallyConnection();
