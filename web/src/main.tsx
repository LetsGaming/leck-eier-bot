import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/ToastContext";
import { ConfirmProvider } from "./components/ConfirmContext";
import { UnsavedChangesProvider } from "./components/UnsavedChangesContext";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <UnsavedChangesProvider>
            <App />
          </UnsavedChangesProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
