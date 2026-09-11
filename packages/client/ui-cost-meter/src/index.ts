/**
 * Token usage and cost plugin, node half.
 *
 * Deliberately empty. Costs are derived on the browser half from durable
 * provider usage and the model route that produced it; there is no Host-side
 * state to own and no model-facing input to add. The browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration.
 */

/** Host plugin body — this surface needs no Host-side contribution. */
export function apply(): void {}
