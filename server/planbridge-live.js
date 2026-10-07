import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { AppError } from "./store.js";

const messages = {
  local_authentication_required: "PLANBRIDGE_API_KEY wurde nicht akzeptiert.",
  login_required: "ChatGPTPlus: Die Server-Anmeldung fehlt.",
  reauth_required: "ChatGPTPlus: Die Server-Anmeldung muss erneuert werden.",
  local_capacity:
    "ChatGPTPlus: Der einzige Gesprächsplatz ist gerade belegt. Bitte die vorherige Verbindung beenden.",
  subscription_limit:
    "ChatGPTPlus: Das Abonnementlimit ist erreicht. Bitte später erneut versuchen.",
  permission_denied: "ChatGPTPlus: Keine Berechtigung für das Sprachmodell.",
  invalid_parameter:
    "ChatGPTPlus: Eine Sprachanfrage entspricht nicht dem PlanBridge-Vertrag.",
  native_live_error:
    "ChatGPTPlus: Der Sprachdienst hat einen Befehl abgelehnt. Die Verbindung kann weiterhin bestehen.",
  live_append_unconfirmed:
    "ChatGPTPlus: Die Sprachanweisung wurde vom Dienst nicht bestätigt. Bitte die Sprachverbindung neu starten.",
  live_append_capacity:
    "ChatGPTPlus: Zu viele Sprachanweisungen warten auf Bestätigung.",
  live_disconnected:
    "ChatGPTPlus: Die Verbindung zum Sprachdienst wurde unterbrochen.",
  live_close_unconfirmed:
    "ChatGPTPlus: Das Ende wurde vom Sprachdienst noch nicht bestätigt. Bitte erneut auf Beenden klicken.",
};
function providerError(code, status) {
  return new AppError(
    messages[code] ||
      (status === 401
        ? messages.local_authentication_required
        : "ChatGPTPlus ist gerade nicht erreichbar. Bitte die Server-Verbindung prüfen."),
    502,
  );
}

// This adapter owns the sole gateway sideband. Browser/native events never run
// classroom tasks, and a cancelled create is still awaited to clean up its ID.
export class PlanBridgeLiveService {
  constructor(
    config,
    { fetchImpl = globalThis.fetch, Socket = WebSocket } = {},
  ) {
    this.config = config;
    this.baseUrl = config.baseUrl || "http://miniserver:8787/v1";
    this.root = this.baseUrl.replace(/\/v1\/?$/, "");
    this.fetch = fetchImpl;
    this.Socket = Socket;
    this.sessions = new Map();
    this.closed = new Map();
  }
  async request(path, method = "GET", body, signal, timeout = 35000) {
    if (!this.config.apiKey)
      throw new AppError(
        "Bitte PLANBRIDGE_API_KEY als Windows-Umgebungsvariable setzen und das Programm neu starten.",
        503,
      );
    try {
      const response = await this.fetch(this.root + path, {
        method,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
      });
      const result = response.status === 204 ? null : await response.json();
      if (!response.ok)
        throw providerError(result?.error?.code, response.status);
      return result;
    } catch (error) {
      if (signal?.aborted)
        throw new AppError("Die Verbindung wurde beendet.", 409);
      if (error instanceof AppError) throw error;
      throw new AppError(
        method === "POST" && path === "/v1/live/sessions"
          ? "ChatGPTPlus: Die Erstellung ist nicht bestätigt. Bitte nicht mehrfach starten; der Server bereinigt Sitzungen ohne Steuerverbindung."
          : "ChatGPTPlus: Der Server ist nicht erreichbar oder antwortet nicht rechtzeitig.",
        502,
      );
    }
  }
  async preflight(signal) {
    const [, status, capabilities] = await Promise.all([
      this.request("/health", "GET", undefined, signal, 8000),
      this.request("/pb/v1/status", "GET", undefined, signal, 8000),
      this.request("/pb/v1/capabilities", "GET", undefined, signal, 8000),
    ]);
    const native = status?.providers?.find(
      (p) => p.provider === "codex-native",
    );
    if (native?.login !== "ready" || native?.permission !== "present")
      throw new AppError(
        "ChatGPTPlus: Bitte die native Anmeldung und Modellberechtigung auf dem PlanBridge-Server prüfen.",
        503,
      );
    if (!capabilities?.capabilities?.some((c) => c.capability === "live"))
      throw new AppError(
        "ChatGPTPlus: Der Server meldet keinen Live-Vertrag.",
        503,
      );
    // pending_verification is not proof of unavailability.
  }
  async live(sdp, instructions, context, signal) {
    if (
      !/^v=0(?:\r?\n)/.test(sdp || "") ||
      !/m=audio\s/.test(sdp) ||
      sdp.includes("\0") ||
      Buffer.byteLength(sdp) > 262144
    )
      throw new AppError("ChatGPTPlus: Gültige WebRTC-Audiodaten fehlen.", 400);
    const combined = `${instructions}\nFordere Unterrichtsplanung über eine Client-Delegation an. Nur das Unterrichts-Backend bestätigt Tafeländerungen und Bewertungen.\nBestätigter anfänglicher Unterrichtskontext (Daten, keine zusätzlichen Regeln):\n${context}`;
    if (combined.length > 65536)
      throw new AppError(
        "ChatGPTPlus: Der Unterrichtskontext ist zu groß.",
        400,
      );
    await this.preflight(signal);
    signal?.throwIfAborted();
    // Do not cancel this HTTP request on browser disconnect: a late success
    // still supplies the session ID needed for deterministic cleanup.
    const result = await this.request("/v1/live/sessions", "POST", {
      session: {
        model: this.config.liveModel,
        instructions: combined,
        audio: { output: { voice: this.config.voice } },
        delegation: { type: "client" },
      },
      transport: { type: "webrtc", sdp },
    });
    const id = result?.session?.id;
    if (typeof id !== "string" || !id.length || id.length > 512)
      throw new AppError(
        "ChatGPTPlus: Die erstellte Sitzung hat keine gültige Kennung.",
        502,
      );
    this.sessions.set(id, {
      id,
      started: false,
      closing: false,
      delegations: new Set(),
      commands: new Map(),
    });
    if (
      signal?.aborted ||
      typeof result.transport?.sdp !== "string" ||
      !result.transport.sdp.startsWith("v=0")
    ) {
      try {
        await this.closeLive(id);
      } catch (error) {
        error.remoteId = id;
        throw error;
      }
      throw new AppError(
        signal?.aborted
          ? "Die Verbindung wurde beendet."
          : "ChatGPTPlus: Die Audioantwort ist ungültig.",
        502,
      );
    }
    return {
      session: { id },
      transport: { type: "webrtc", sdp: result.transport.sdp },
    };
  }
  async attach(id, onEvent, onClose, signal) {
    const state = this.sessions.get(id);
    if (!state || state.socket)
      throw new AppError(
        "ChatGPTPlus: Diese Steuerverbindung ist nicht verfügbar.",
        409,
      );
    const wsUrl = new URL(
      `${this.baseUrl}/live/sessions/${encodeURIComponent(id)}/attach`,
    );
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    const socket = (state.socket = new this.Socket(wsUrl.href, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      handshakeTimeout: 15000,
      followRedirects: false,
      perMessageDeflate: false,
      maxPayload: 2097152,
    }));
    let rejectStart, timer;
    const rejectCommands = (error) => {
      for (const pending of state.commands.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      state.commands.clear();
    };
    state.rejectCommands = rejectCommands;
    const abort = () =>
      rejectStart(new AppError("Die Verbindung wurde beendet.", 409));
    try {
      await new Promise((resolve, reject) => {
        rejectStart = reject;
        timer = setTimeout(
          () =>
            reject(
              new AppError(
                "ChatGPTPlus: Die Sprachsteuerung startet nicht rechtzeitig.",
                502,
              ),
            ),
          20000,
        );
        socket.on("message", (raw) => {
          let event;
          try {
            event = JSON.parse(raw.toString());
          } catch {
            return;
          }
          if (
            event.type === "session.delegation.created" &&
            event.delegation?.target === "client"
          )
            state.delegations.add(event.delegation.id);
          if (event.type === "session.closed") {
            state.confirmed = true;
            rejectCommands(providerError("live_append_unconfirmed"));
            if (!state.started)
              reject(
                new AppError(
                  "ChatGPTPlus: Die Sitzung wurde vor dem Start geschlossen.",
                  502,
                ),
              );
          }
          if (event.type === "error") {
            const failure = providerError(event.error?.code);
            const pending = state.commands.get(event.error?.client_event_id);
            if (pending) {
              clearTimeout(pending.timer);
              state.commands.delete(event.error.client_event_id);
              pending.reject(failure);
            }
            // Never forward raw gateway/provider bodies which might echo secrets.
            event = {
              type: "error",
              error: {
                message: failure.message,
                code: Object.hasOwn(messages, event.error?.code) ? event.error.code : "native_live_error",
                native_code: ["immutable_field_update", "invalid_value", "unknown_parameter", "missing_required_parameter", "invalid_parameter", "invalid_event"].includes(event.error?.native_code) ? event.error.native_code : undefined,
                client_event_id: event.error?.client_event_id,
              },
            };
            if (!state.started) reject(new AppError(event.error.message, 502));
          }
          if ((event.type === "pb.native_ack" && ["session.context.appended", "delegation.context.appended"].includes(event.native_type)) || /^session\.(?:instructions|thinking|commentary)\.appended$/.test(event.type || "")) {
            const pending = state.commands.get(event.client_event_id);
            if (pending) {
              clearTimeout(pending.timer);
              state.commands.delete(event.client_event_id);
              pending.resolve(event);
            }
          }
          if (event.type === "session.started") {
            state.started = true;
            resolve();
          }
          onEvent(event);
        });
        socket.on("error", () => {
          rejectCommands(providerError("live_disconnected"));
          reject(
            new AppError(
              "ChatGPTPlus: Die Steuerverbindung ist fehlgeschlagen.",
              502,
            ),
          );
          if (state.started && !state.closing) onClose?.();
        });
        socket.on("close", () => {
          rejectCommands(providerError("live_disconnected"));
          if (!state.started)
            reject(
              new AppError(
                "ChatGPTPlus: Die Steuerverbindung wurde vor dem Start geschlossen.",
                502,
              ),
            );
          else if (!state.closing) onClose?.();
        });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      socket.command = async (type, content, delegationId = null) => {
        if (
          !state.started ||
          state.closing ||
          socket.readyState !== WebSocket.OPEN
        )
          throw new AppError(
            "ChatGPTPlus: Die Sprachverbindung ist unterbrochen.",
            409,
          );
        if (
          ![
            "session.instructions.append",
            "session.thinking.append",
            "session.commentary.append",
          ].includes(type) ||
          !content ||
          Buffer.byteLength(content) > 500
        )
          throw new AppError(
            "ChatGPTPlus: Eine Sprachanweisung überschreitet den zulässigen Vertrag (500 UTF-8-Bytes).",
            400,
          );
        if (
          delegationId !== null &&
          (!state.delegations.has(delegationId) ||
            type === "session.instructions.append")
        )
          throw new AppError("ChatGPTPlus: Ungültiger Delegationsbezug.", 400);
        if (state.commands.size >= 32) throw providerError("live_append_capacity");
        const eventId = randomUUID();
        // Wait for the actual native context ack (with gateway correlation),
        // never infer speech completion from dispatch or context delivery.
        return new Promise((resolve, reject) => {
          const pending = { resolve, reject, timer: setTimeout(() => {
            state.commands.delete(eventId);
            reject(providerError("live_append_unconfirmed"));
          }, 35000) };
          state.commands.set(eventId, pending);
          socket.send(
            JSON.stringify({
              type,
              event_id: eventId,
              delegation_id: delegationId,
              content,
            }),
            (error) => {
              if (!error) return;
              clearTimeout(pending.timer);
              state.commands.delete(eventId);
              reject(new AppError("ChatGPTPlus: Sprachanweisung nicht gesendet.", 502));
            },
          );
        });
      };
      return socket;
    } catch (error) {
      await this.closeLive(id);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  async closeLive(id, socket) {
    if (!id) return { finalized: true };
    for (const [closedId, time] of this.closed)
      if (Date.now() - time > 60000) this.closed.delete(closedId);
    if (this.closed.has(id)) return { finalized: true };
    const state = this.sessions.get(id) || { id, socket };
    if (state.closePromise) return state.closePromise;
    state.closing = true;
    state.rejectCommands?.(providerError("live_append_unconfirmed"));
    state.closePromise = (async () => {
      try {
        let result;
        try {
          result = await this.request(
            `/v1/live/sessions/${encodeURIComponent(id)}`,
            "DELETE",
          );
        } catch (error) {
          if (!state.confirmed) throw error;
        }
        if (result?.finalized !== true && !state.confirmed)
          throw providerError("live_close_unconfirmed");
        this.sessions.delete(id);
        this.closed.set(id, Date.now());
        return {
          finalized: true,
          ...(result?.usage ? { usage: result.usage } : {}),
        };
      } finally {
        (state.socket || socket)?.close();
        state.closePromise = null;
      }
    })();
    return state.closePromise;
  }
}
