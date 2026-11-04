export const discoverSyncCompanies = () => window.connector.testTallyConnection();
export const startCompanySync = (payload) => window.connector.startLocalSync(payload);
export const pauseCompanySync = () => window.connector.pauseLocalSync();
