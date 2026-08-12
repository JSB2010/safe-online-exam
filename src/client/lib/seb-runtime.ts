export function detectSebRuntime(): boolean {
  const userAgent = navigator.userAgent || "";
  return (
    /SafeExamBrowser|Safe Exam Browser|SEB[/; _-]|SEB$/iu.test(userAgent) ||
    !!((window as any).SafeExamBrowser || (window as any).SEB)
  );
}

export async function readSebConfigKeyHash(): Promise<string | null> {
  const seb = (window as any).SafeExamBrowser;
  if (!seb?.security) {
    return null;
  }
  if (typeof seb.security.updateKeys === "function") {
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      try {
        seb.security.updateKeys(finish);
        window.setTimeout(finish, 1500);
      } catch {
        finish();
      }
    });
  }
  return readSebConfigKeyValue(seb.security.configKey);
}

function readSebConfigKeyValue(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "function") {
    try {
      const result = value();
      return typeof result === "string" && result.length > 0 ? result : null;
    } catch {
      return null;
    }
  }
  return null;
}
