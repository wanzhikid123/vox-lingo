import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import { config } from "../server/config.js";
import { PlanBridgeLiveService } from "../server/planbridge-live.js";

// Explicit opt-in: creates one real subscription Live session with synthetic
// browser audio. Never opens learner data or loads credentials from disk.
if (!process.argv.includes("--run")) {
  console.log(
    "Run node scripts/smoke-chatgptplus.js --run to test one synthetic Live session.",
  );
  process.exit();
}
const role = config.modelDefaults.live.chatgptplus;
const service = new PlanBridgeLiveService({ ...role, liveModel: role.model });
const events = [];
const server = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end("<!doctype html><title>Vox-Lingo synthetic Live check</title>");
});
let browser, page, remoteId, socket;
const result = {
  baseUrl: role.baseUrl,
  model: role.model,
  voice: role.voice,
  syntheticAudio: true,
};
try {
  await service.preflight();
  result.preflight = "passed";
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const browserContext = await browser.newContext({
    permissions: ["microphone"],
  });
  page = await browserContext.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const sdp = await page.evaluate(async () => {
    const stream = (window.smokeStream =
      await navigator.mediaDevices.getUserMedia({ audio: true }));
    const pc = (window.smokePeer = new RTCPeerConnection());
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    const channel = (window.smokeChannel = pc.createDataChannel("live-events"));
    channel.onmessage = () => {};
    pc.ontrack = (e) => {
      const audio = (window.smokeAudio = document.createElement("audio"));
      audio.autoplay = true;
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {});
    };
    await pc.setLocalDescription(await pc.createOffer());
    if (pc.iceGatheringState !== "complete")
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("ICE gathering timeout")),
          10000,
        );
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === "complete") {
            clearTimeout(timeout);
            resolve();
          }
        };
      });
    return pc.localDescription.sdp;
  });
  const created = await service.live(
    sdp,
    "This is a synthetic connectivity test. Speak one brief English greeting when instructed. No tools or lesson planning are needed.",
    JSON.stringify({ synthetic: true, learnerData: false }),
  );
  remoteId = created.session.id;
  result.create = "passed";
  socket = await service.attach(remoteId, (event) => events.push(event));
  result.sideband = "started";
  await page.evaluate(
    (sdp) => window.smokePeer.setRemoteDescription({ type: "answer", sdp }),
    created.transport.sdp,
  );
  await page.waitForFunction(
    () => window.smokePeer.connectionState === "connected",
    null,
    { timeout: 20000 },
  );
  result.webrtc = "connected";
  await socket.command(
    "session.instructions.append",
    "Say one brief greeting in English now. This is only a synthetic connection check.",
  );
  await socket.command(
    "session.commentary.append",
    "Hello from Vox-Lingo. The synthetic connection check is ready.",
  );
  result.nativeAcknowledgements = "passed";
  await page.waitForFunction(
    async () => {
      const stats = await window.smokePeer.getStats();
      return [...stats.values()].some(
        (s) =>
          s.type === "inbound-rtp" && s.kind === "audio" && s.bytesReceived > 0,
      );
    },
    null,
    { timeout: 20000 },
  );
  result.audioReceived = true;
  const speechDeadline = Date.now() + 15000;
  while (
    !events.some((event) => event.type === "session.output_transcript.delta") &&
    Date.now() < speechDeadline
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  result.outputTranscripts = events.filter(
    (event) => event.type === "session.output_transcript.delta",
  ).length;
  result.providerErrors = events.filter(
    (event) => event.type === "error",
  ).length;
  if (result.providerErrors)
    throw new Error("The provider emitted a protocol error.");
  if (!result.outputTranscripts)
    throw new Error(
      "No spoken output transcript was observed before the timeout.",
    );
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  if (remoteId) {
    try {
      const closed = await service.closeLive(remoteId, socket);
      result.finalized = closed.finalized;
    } catch (error) {
      result.closeError = error.message;
      process.exitCode = 1;
    }
  }
  await page
    ?.evaluate(() => {
      window.smokeStream?.getTracks().forEach((track) => track.stop());
      window.smokeChannel?.close();
      window.smokePeer?.close();
    })
    .catch(() => {});
  await browser?.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  console.log(JSON.stringify(result));
}
