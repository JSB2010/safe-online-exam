import { BootstrapPayload } from "../types.js";

export function readBootstrap(): BootstrapPayload {
  const element = document.getElementById("seb-bootstrap");
  if (!element?.textContent) {
    return { view: "teacher", data: {} };
  }
  try {
    const value = JSON.parse(element.textContent) as Partial<BootstrapPayload>;
    return typeof value.view === "string" && value.data && typeof value.data === "object"
      ? { view: value.view, data: value.data }
      : { view: "teacher", data: {} };
  } catch {
    return { view: "teacher", data: {} };
  }
}
