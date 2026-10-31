import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "react-toastify/dist/ReactToastify.css";
import "./index.css";
import { TooltipProvider } from "./components/ui/tooltip";
import { ThemeProvider } from "./context/theme-context";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system">
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
);
