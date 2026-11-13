import "@/index.css";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "@/grid/app";

createRoot(document.getElementById("root") as HTMLElement).render(
  <TooltipProvider>
    <App />
    <Toaster position="bottom-right" />
  </TooltipProvider>,
);
