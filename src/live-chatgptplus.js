import { LiveConnection as WebRTCLiveConnection } from "./live-openai.js";

// The gateway sideband reaches this browser through local SSE. The native
// DataChannel is needed for negotiation but never supplies business events.
export class LiveConnection extends WebRTCLiveConnection {
  constructor(id, stream, callbacks) {
    super(id, stream, callbacks, { serverEvents: true });
  }
}
