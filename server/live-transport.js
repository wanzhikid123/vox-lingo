import { WebSocketServer } from "ws";

// Local media endpoint: enforce Origin/Host independently of Express middleware.
// A single-use ticket binds a browser to its already prepared lesson connection.
export function attachLiveTransport(server, classroom, config) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 32768 });
  server.on("upgrade", (req, socket, head) => {
    const fail = () => {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
    };
    const hosts = [`127.0.0.1:${config.port}`, `localhost:${config.port}`];
    if (
      !hosts.includes(req.headers.host) ||
      !hosts.map((h) => `http://${h}`).includes(req.headers.origin)
    )
      return fail();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = /^\/api\/lessons\/([^/]+)\/audio$/.exec(url.pathname);
    const room = match && classroom.rooms.get(match[1]);
    if (
      !room ||
      !room.mediaTicket ||
      room.mediaTicket !== url.searchParams.get("ticket") ||
      Date.now() > room.mediaTicketExpires ||
      room.media ||
      room.closing ||
      room.socket?.readyState !== 1
    )
      return fail();
    room.mediaTicket = null;
    clearTimeout(room.mediaTimer);
    sockets.handleUpgrade(req, socket, head, (ws) => {
      room.media = ws;
      let bytes = 0,
        since = Date.now();
      const close = () => {
        if (!room.closing) classroom.disconnect(room.id).catch(() => {});
      };
      ws.on("error", close);
      ws.on("close", close);
      ws.on("message", (data, binary) => {
        if (room.closing) return;
        try {
          if (Date.now() - since > 1000) {
            bytes = 0;
            since = Date.now();
          }
          bytes += data.length;
          if (bytes > 96000) return ws.close(1008, "Audio rate exceeded");
          if (binary) {
            if (!data.length || data.length % 2)
              return ws.close(1008, "Invalid PCM");
            room.socket.audio(data);
          } else {
            const event = JSON.parse(data.toString());
            if (event.type === "audio.end") room.socket.audioEnd();
            else if (
              event.type === "playback.drained" &&
              event.epoch === room.socket.epoch
            )
              room.socket.playbackDrained = true;
            else if (event.type === "input.activity")
              classroom.audioActivity(room.id);
            else if (event.type === "session.close") ws.close();
          }
        } catch {
          ws.close(1008, "Invalid media event");
        }
      });
      ws.send(JSON.stringify({ type: "session.started" }));
    });
  });
  return {
    close() {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
    },
  };
}
