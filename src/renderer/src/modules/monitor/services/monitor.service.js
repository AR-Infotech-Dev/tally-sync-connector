export const loadRecentActivity = (limit = 100) => window.connector.loadActivity({ limit });
export const loadLedgerSyncStatus = () => window.connector.getLedgerSyncStatus();
