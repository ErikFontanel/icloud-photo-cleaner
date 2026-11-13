import "@/index.css";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TableApp } from "@/table/app";

createRoot(document.getElementById("root") as HTMLElement).render(
  <TooltipProvider>
    <TableApp />
    <Toaster position="bottom-right" />
  </TooltipProvider>,
);
