/* StrictMode は使わない(contracts §4: レンダラー二重初期化の防止) */
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
