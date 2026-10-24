import { initializeDiagnostics } from "./lib/diagnostics";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

initializeDiagnostics();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
