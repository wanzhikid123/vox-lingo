import { config } from "../server/config.js";
// Launch scripts receive only local paths and port, never credentials.
console.log(JSON.stringify({ port: config.port, dataDir: config.dataDir }));
