import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@xterm/xterm/css/xterm.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("The #root element is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary scope="The console">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
