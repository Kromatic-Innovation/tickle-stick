import * as fs from "node:fs";
import * as path from "node:path";
import * as YAML from "yaml";
import { tickleStickConfigSchema, type TickleStickConfig } from "./schema.js";

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

function interpolateEnvVars(content: string): string {
  return content.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
    const value = process.env[varName];
    return value ?? "";
  });
}

const DEFAULT_PATHS = ["tickle-stick.yaml", "config/tickle-stick.yaml"];

function resolveConfigPath(explicitPath?: string): string | undefined {
  if (explicitPath) {
    if (fs.existsSync(explicitPath)) return explicitPath;
    throw new Error(`Config file not found: ${explicitPath}`);
  }
  for (const candidate of DEFAULT_PATHS) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return undefined;
}

export function loadConfig(configPath?: string): TickleStickConfig {
  const resolved = resolveConfigPath(configPath);

  if (!resolved) {
    return tickleStickConfigSchema.parse({ tickleStick: {} });
  }

  const raw = fs.readFileSync(resolved, "utf-8");
  const interpolated = interpolateEnvVars(raw);
  const parsed = YAML.parse(interpolated);
  return tickleStickConfigSchema.parse(parsed);
}

export function loadConfigFromString(yamlContent: string): TickleStickConfig {
  const interpolated = interpolateEnvVars(yamlContent);
  const parsed = YAML.parse(interpolated);
  return tickleStickConfigSchema.parse(parsed);
}
