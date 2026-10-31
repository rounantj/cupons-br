/** URL da API (definida no build: VITE_API_URL). O mesmo backend serve as duas extensões. */
export const API_URL: string = import.meta.env.VITE_API_URL || "http://localhost:3000";
