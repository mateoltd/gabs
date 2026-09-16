import { createRoot } from "react-dom/client";
import { App } from "@suite/app-web";
import "@suite/design-tokens";
import "@suite/ui-web/styles.css";
import "@suite/app-web/styles.css";
createRoot(document.getElementById("root")!).render(<App />);
