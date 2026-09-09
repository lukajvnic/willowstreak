import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { AvatarProvider } from "./lib/AvatarContext";
import { AuthProvider } from "./lib/auth";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <AvatarProvider>
        <App />
      </AvatarProvider>
    </AuthProvider>
  </StrictMode>,
);
