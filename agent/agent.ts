import { defineAgent } from "eve";

/**
 * Modelo vía AI Gateway (opcional). El CLI determinista no depende de esto.
 * Si no hay credenciales Gateway, usa `npm run linky` para onboarding/plan/preview/apply mock.
 */
export default defineAgent({
  model: "openai/gpt-4.1-mini",
});
