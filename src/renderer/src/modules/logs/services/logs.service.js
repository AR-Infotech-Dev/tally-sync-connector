export const getActivityLogs = (filters = {}) => window.connector.loadActivity({ ...filters, limit: 5000 });
export const clearActivityLogs = () => window.connector.clearActivity();
export const retrySalesOrder = (requestId) => window.connector.retrySalesOrder(requestId);
