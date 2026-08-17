import type { RefObject } from "react";
import { useEffect } from "react";

export function useEscapeToClose(onClose?: () => void) {
  useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}

export function useDialogInitialFocus(ref?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!ref) return;
    const timer = window.setTimeout(() => ref.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [ref]);
}
