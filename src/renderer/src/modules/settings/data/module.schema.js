export const settingsModuleSchema = {
  title: "Settings",
  sections: [
    { id: "server", title: "Server Connection", description: "Connect this Connector to your sync Server." },
    { id: "tally", title: "Tally Connection", description: "Choose the local TallyPrime company and test access." },
    { id: "service", title: "Background Service", description: "Choose how Connector stays available on this computer." },
    { id: "processing", title: "Processing & Logs", description: "Set request timeout and local activity log retention." },
  ],
};
