import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { roleProviders, publicConfig, root } from "./config.js";
import { createAIServices } from "./ai.js";
import { AppError } from "./store.js";

const names = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  deepseek: "DeepSeek",
};
const fields = ["provider", "model", "voice", "reasoningEffort", "serviceTier"];
const visible = (value) =>
  Object.fromEntries(
    fields
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
const providersOnly = (roles) =>
  Object.fromEntries(
    Object.entries(roles).map(([role, value]) => [
      role,
      { provider: value.provider },
    ]),
  );
const rolesSchema = z.strictObject(
  Object.fromEntries(
    Object.entries(roleProviders).map(([role, providers]) => [
      role,
      z.strictObject({ provider: z.enum(providers) }),
    ]),
  ),
);
// Read old snapshots only to recover provider choices. Their model parameters
// never override the environment configuration, even if previously saved.
const legacyRolesSchema = z.strictObject(
  Object.fromEntries(
    Object.entries(roleProviders).map(([role, providers]) => [
      role,
      z.object({ provider: z.enum(providers) }),
    ]),
  ),
);
const savedSchema = z.discriminatedUnion("version", [
  z.strictObject({ version: z.literal(1), roles: legacyRolesSchema }),
  z.strictObject({ version: z.literal(2), roles: rolesSchema }),
]);
const requestSchema = z.strictObject({
  revision: z.string(),
  roles: rolesSchema,
});
// One stable facade per role lets existing controllers use the saved services.
// Commit synchronously so no request observes a partially switched configuration.
export class ModelSettings {
  constructor(
    config,
    {
      file = join(root, "data", "model-settings.json"),
      factory = createAIServices,
    } = {},
  ) {
    this.config = config;
    this.defaults = structuredClone(config.modelDefaults);
    this.defaultRoles = providersOnly(
      Object.fromEntries(
        Object.keys(roleProviders).map((role) => [role, config[role]]),
      ),
    );
    this.file = file;
    this.factory = factory;
    this.revision = randomUUID();
    this.pending = 0;
    this.isBusy = () => false;
    if (file && existsSync(file)) {
      try {
        const saved = savedSchema.parse(JSON.parse(readFileSync(file, "utf8")));

        Object.assign(config, this.resolve(saved.roles));
      } catch {
        throw new Error(
          "Gespeicherte Modelleinstellungen sind ungültig. Bitte data/model-settings.json prüfen.",
        );
      }
    }
    this.services = factory(config);
    for (const [service, methods] of Object.entries({
      classroomAI: ["responses", "live", "attach", "closeLive"],
      teacherAI: ["responses"],
      transcriptionAI: ["transcribe"],
    })) {
      this[service] = Object.fromEntries(
        methods.map((method) => [
          method,
          async (...args) => {
            const selected = this.services[service];
            this.pending++;
            try {
              return await selected[method](...args);
            } finally {
              this.pending--;
            }
          },
        ]),
      );
    }
  }
  options() {
    return Object.fromEntries(
      Object.entries(roleProviders).map(([role, providers]) => [
        role,
        Object.fromEntries(
          providers.map((provider) => {
            const defaults = this.defaults[role][provider];
            return [
              provider,
              {
                label: names[provider],
                defaults: { provider },
                values: visible(defaults),
                apiKeyName: defaults.apiKeyName,
                keyConfigured: Boolean(defaults.apiKey),
              },
            ];
          }),
        ),
      ]),
    );
  }
  state() {
    return {
      revision: this.revision,
      roles: Object.fromEntries(
        Object.keys(roleProviders).map((role) => [
          role,
          { provider: this.config[role].provider },
        ]),
      ),
      defaults: this.defaultRoles,
      options: this.options(),
      busy: this.pending > 0 || this.isBusy(),
      health: publicConfig(this.config),
    };
  }
  resolve(roles) {
    return Object.fromEntries(
      Object.entries(roles).map(([role, value]) => [
        role,
        {
          ...this.defaults[role][value.provider],
        },
      ]),
    );
  }
  save(raw) {
    const { revision, roles } = requestSchema.parse(raw);
    if (revision !== this.revision)
      throw new AppError(
        "Die Einstellungen wurden in einem anderen Fenster geändert. Bitte schließen und erneut öffnen.",
        409,
      );
    if (this.pending || this.isBusy())
      throw new AppError(
        "Bitte die laufende Stunde beenden und warten, bis Vorbereitung und Spracheingabe abgeschlossen sind. Danach erneut speichern.",
        409,
      );

    const next = this.resolve(roles);
    const services = this.factory({ ...this.config, ...next });
    if (this.file) {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(
          temporary,
          JSON.stringify({ version: 2, roles }, null, 2) + "\n",
          { mode: 0o600, flag: "wx" },
        );
        renameSync(temporary, this.file);
      } catch {
        throw new AppError(
          "Die Einstellungen konnten nicht gespeichert werden. Die bisherigen Einstellungen bleiben aktiv.",
          500,
        );
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    Object.assign(this.config, next);
    this.services = services;
    this.revision = randomUUID();
    return this.state();
  }
}
