import * as fs from "node:fs";
import * as path from "node:path";
import * as YAML from "yaml";
import { tickleStickConfigSchema, type TickleStickConfig } from "./schema.js";

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;
const FILE_REF_PREFIX = "$file:";

function interpolateEnvVars(content: string): string {
  const missing = new Set<string>();
  const result = content.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      missing.add(varName);
      return "";
    }
    return value;
  });
  if (missing.size > 0) {
    // Substituting empty string for an undefined var can silently produce an
    // empty command/path/credential. Keep the (non-breaking) empty-string
    // behavior but warn so the misconfiguration is visible.
    process.stderr.write(
      `[tickle-stick] config references undefined env var(s): ${[...missing].join(", ")} — substituted empty string\n`,
    );
  }
  return result;
}

/**
 * Recursively walk a parsed config object and replace any string value
 * starting with `$file:` with the contents of the referenced file.
 * Paths are resolved relative to `basePath`.
 */
function resolveFileRefs(obj: unknown, basePath: string): unknown {
  if (typeof obj === "string" && obj.startsWith(FILE_REF_PREFIX)) {
    const filePath = path.resolve(basePath, obj.slice(FILE_REF_PREFIX.length));
    if (!fs.existsSync(filePath)) {
      throw new Error(`File reference not found: ${filePath} (from ${obj})`);
    }
    return fs.readFileSync(filePath, "utf-8");
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveFileRefs(item, basePath));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveFileRefs(value, basePath);
    }
    return result;
  }
  return obj;
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
  const withFileRefs = resolveFileRefs(parsed, path.dirname(resolved));
  return tickleStickConfigSchema.parse(withFileRefs);
}

export function loadConfigFromString(
  yamlContent: string,
  basePath?: string,
): TickleStickConfig {
  const interpolated = interpolateEnvVars(yamlContent);
  const parsed = YAML.parse(interpolated);
  const withFileRefs = basePath ? resolveFileRefs(parsed, basePath) : parsed;
  return tickleStickConfigSchema.parse(withFileRefs);
}
