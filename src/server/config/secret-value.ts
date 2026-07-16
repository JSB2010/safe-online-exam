import { readFileSync } from "node:fs";

export function resolveSecretValue(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const directValue = normalizedSetting(env[name]);
  const fileSettingName = `${name}_FILE`;
  const filePath = normalizedSetting(env[fileSettingName]);

  if (directValue !== undefined && filePath !== undefined) {
    throw new Error(`${name} and ${fileSettingName} cannot both be set`);
  }
  if (directValue !== undefined) {
    return directValue;
  }
  if (filePath === undefined) {
    return undefined;
  }

  try {
    return readFileSync(filePath, "utf8").replace(/\r?\n$/u, "");
  } catch (cause) {
    throw new Error(`Unable to read ${name} from ${fileSettingName}`, { cause });
  }
}

function normalizedSetting(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}
