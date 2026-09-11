/**
 * Context-import UI plugin, node half. Pure UI plugin: the empty apply exists
 * so the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration. The `/import` command itself lives in `dsh-context-import`.
 */

/** Host plugin body — no host-side behavior for this source plugin. */
export function apply(): void {}
