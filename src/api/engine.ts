import { VM } from 'vm2';
import { runAction } from '../modules/runner';

/**
 * Return true when `s` is a valid JavaScript identifier name.
 * We use this to safely inject node names as parameter names when
 * constructing dynamic functions for template evaluation.
 */
/**
 * Check whether a string is a valid JavaScript identifier.
 * @param s - candidate identifier
 * @returns true when `s` is a valid identifier
 */
function isValidIdentifier(s: string) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
}

/**
 * Collect declared names from workflow and nodes. These names are
 * optionally exposed as parameters to template evaluation when they
 * are valid JS identifiers.
 * @param wf - workflow definition
 * @param nodes - nodes environment
 * @returns Set of declared names
 */
function collectDeclaredNames(wf: any, nodes: Record<string, any> | undefined) {
    const declaredNames = new Set<string>();
    try {
        for (const t of (wf.triggers || [])) if (t && t.name) {
            declaredNames.add(t.name);
        }
        for (const a of (wf.actions || [])) if (a && a.name) {
            declaredNames.add(a.name);
        }
    } catch (e) { /* ignore malformed wf */ }

    for (const k of Object.keys(nodes || {})) {
        declaredNames.add(k);
    }
    return declaredNames;
}

/**
 * Build the parameter name/value arrays passed to the evaluator.
 * @param wf - workflow definition
 * @param envNodes - nodes environment
 * @returns object with `paramNames` and `paramValues`
 */
function buildTemplateParams(wf: any, envNodes: Record<string, any> | undefined) {
    const nodes = envNodes || {};
    const paramNames: string[] = ['wf', 'body', 'params', 'query', 'parent', 'inputs', 'nodes'];
    const paramValues: any[] = [wf, undefined, undefined, undefined, undefined, undefined, nodes];

    const declaredNames = collectDeclaredNames(wf, nodes);
    for (const name of Array.from(declaredNames)) {
        if (isValidIdentifier(name)) {
            paramNames.push(name);
            paramValues.push((nodes || {})[name]);
        }
    }
    return { paramNames, paramValues };
}

/**
 * Evaluate an expression inside a small vm2 sandbox.
 *
 * This helper wraps the provided `expr` in an IIFE that destructures
 * the provided parameters from a single `params` object. The `params`
 * object is frozen into the sandbox so the evaluated code can read the
 * provided values but cannot reassign them.
 *
 * Notes:
 * - The VM is created with a short `timeout` to avoid long-running
 *   or CPU-bound template evaluations.
 * - The sandbox is intentionally empty; only the frozen `params`
 *   object is exposed to the guest code.
 * - Errors thrown by `vm.run` (syntax/runtime/timeout) will propagate
 *   to the caller and should be handled where this helper is used.
 *
 * @param expr - JavaScript expression to evaluate (string)
 * @param paramNames - array of parameter names exposed to the expression
 * @param paramValues - array of parameter values (values correspond to names)
 * @returns the evaluated result
 */
function evalExpression(expr: string, paramNames: string[], paramValues: any[]) {
    // Create a vm with a small timeout and an isolated sandbox.
    const vm = new VM({
        timeout: 500,
        sandbox: {}
    });

    // Build a single `params` object that maps parameter names to values.
    const params = Object.fromEntries(
        paramNames.map((name, i) => [name, paramValues[i]])
    );

    // Wrap the expression in an IIFE that destructures `params` into
    // the local variable names expected by templates. Wrapping ensures
    // object literals evaluate correctly and keeps evaluation scope local.
    const wrapped = `
        (function(params) {
            const { ${paramNames.join(', ')} } = params;
            return (${expr});
        })(params)
    `;

    // Freeze the parameters into the VM so guest code can read them but
    // cannot replace the `params` binding.
    vm.freeze(params, 'params');

    // Execute the wrapped code in the sandbox and return the result.
    return vm.run(wrapped);
}

/**
 * Evaluate a template expression and return a fallback literal when present.
 * This consolidates the fallback extraction logic used in multiple places.
 * @param exprRaw - raw JS expression inside the template markers
 * @param wf - workflow object
 * @param env - evaluation environment
 * @returns evaluated result or fallback literal or undefined
 */
function evaluateTemplateWithFallback(exprRaw: string, wf: any, env: { body?: any; params?: any; query?: any; nodes?: Record<string, any>; parent?: any; inputs?: any; }) {
    try {
        const res = evalTemplateAsJS(exprRaw, wf, env);
        if (res === undefined || res === null || (typeof res === 'string' && res === '')) {
            const m = exprRaw.match(/\|\|\s*(['"])(.*?)\1\s*$/);
            if (m) {
                return m[2];
            }
        }
        return res;
    } catch (e) {
        try {
            const m = exprRaw.match(/\|\|\s*(['"])(.*?)\1/);
            if (m) {
                return m[2];
            }
        } catch (e2) { }
        return undefined;
    }
}

/**
 * Evaluate a small JavaScript expression coming from a template.
 *
 * This function builds a parameter list exposing a small set of
 * well-known names (wf, body, params, query, parent, inputs, nodes)
 * plus any node names (when they are valid identifiers) and then
 * constructs a `new Function(...)` to evaluate the expression.
 *
 * NOTE: This intentionally uses `new Function` for performance and
 * expressiveness. The runner is intended to execute inside a
 * controlled environment (containers/pods). If templates may be
 * provided by untrusted users, consider additional sandboxing.
 *
 * @param expr - JavaScript expression to evaluate (e.g. "nodes.foo.id || 'x'")
 * @param wf - the workflow definition object (used to discover declared names)
 * @param env - environment values (body, params, query, nodes, parent, inputs)
 * @returns the value produced by the evaluated expression
 */
export function evalTemplateAsJS(expr: string, wf: any, env: { body?: any; params?: any; query?: any; nodes?: Record<string, any>; parent?: any; inputs?: any; }) {
    const nodes = env.nodes || {};
    // Build parameter lists (names and initial values)
    const { paramNames, paramValues } = buildTemplateParams(wf, nodes);
    // Fill in runtime values for the base parameters
    paramValues[0] = wf;
    paramValues[1] = env.body;
    paramValues[2] = env.params;
    paramValues[3] = env.query;
    paramValues[4] = env.parent;
    paramValues[5] = env.inputs;
    paramValues[paramValues.length - 1] = nodes;

    try {
        return evalExpression(expr, [...paramNames], [...paramValues]);
    } catch (e) {
        console.error(`Error in template evaluation: ${e}`);
        return undefined;
    }
}

/**
 * Resolve a mapping specification into a concrete value.
 *
 * Supported formats:
 * - Template expressions: "${{ ... }}" — evaluated via `evalTemplateAsJS`
 * - Dotted references: "nodeName.prop.sub", "body.user.email", "params.id" etc.
 * - Special prefix `parent` resolves against `parentCombined`.
 * - `nodes.<nodeName>...` explicitly reads from nodeOutputs.
 *
 * If a template evaluates to undefined/null/empty-string and contains a
 * trailing `|| 'fallback'` literal, the fallback string is returned.
 *
 * @param pathSpec - mapping expression or dotted path
 * @param triggerOutputs - trigger outputs (body/params/query)
 * @param nodeOutputs - map of node outputs by name
 * @param parentCombined - merged parent outputs (optional)
 * @param wf - workflow object (optional)
 * @returns resolved value or undefined when not found
 */
export function mapInputValue(pathSpec: string, triggerOutputs: any, nodeOutputs: Record<string, any>, parentCombined: Record<string, any> | null = null, wf?: any) {
    const spec = (pathSpec || '');

    // Handle template expressions first
    if (typeof spec === 'string') {
        const s = spec.trim();
        if (s.startsWith('${{') && s.endsWith('}}')) {
            const exprRaw = s.slice(3, -2).trim();
            return evaluateTemplateWithFallback(exprRaw, wf, { body: triggerOutputs.body, params: triggerOutputs.params, query: triggerOutputs.query, nodes: nodeOutputs, parent: parentCombined || {} });
        }
    }

    // Non-template: dotted path lookup
    const parts = String(spec).split('.');
    if (!parts[0]) {
        return undefined;
    }

    // Direct node name shorthand: "nodeName.prop"
    if (nodeOutputs && Object.prototype.hasOwnProperty.call(nodeOutputs, parts[0])) {
        let val: any = nodeOutputs[parts[0]];

        for (let i = 1; val !== undefined && i < parts.length; i++) {
            val = val[parts[i]];
        }
        return val;
    }

    // parent.<key> resolves against merged parent outputs
    if (parts[0] === 'parent' && parentCombined) {
        let val: any = parentCombined[parts[1]];

        for (let i = 2; val !== undefined && i < parts.length; i++) {
            val = val[parts[i]];
        }
        return val;
    }

    // body/params/query explicit lookups
    let val: any;

    if (parts[0] === 'body') {
        val = triggerOutputs.body;
    } else if (parts[0] === 'params') {
        val = triggerOutputs.params;
    } else if (parts[0] === 'query') {
        val = triggerOutputs.query;
    } else if (parts[0] === 'nodes') {
        // nodes.<nodeName>.<...>
        const targetNode = parts[1];
        val = nodeOutputs[targetNode];
        for (let i = 2; val !== undefined && i < parts.length; i++) {
            val = val[parts[i]];
        }
        return val;
    } else {
        return undefined;
    }

    for (let i = 1; val !== undefined && i < parts.length; i++) {
        val = val[parts[i]];
    }
    return val;
}

/**
 * Build the inputs object for a node from a mapping definition.
 *
 * - If `mapping.__parents === '__forward'`, parent outputs are merged
 *   into the resulting `mapped` object before evaluating individual mappings.
 * - Every mapping value is passed to `mapInputValue`.
 *
 * @param mapping - mapping definition (key -> pathSpec)
 * @param triggerOutputs - trigger outputs (body/params/query)
 * @param nodeOutputs - map of node outputs by name
 * @param nodeDef - node definition (for parents forwarding)
 * @param parentCombined - merged parent outputs (optional)
 * @param wf - workflow object (optional)
 * @returns resolved mapped inputs
 */
export function buildMappedInputs(mapping: Record<string, any>, triggerOutputs: any, nodeOutputs: Record<string, any>, nodeDef?: any, parentCombined: Record<string, any> | null = null, wf?: any) {
    const mapped: Record<string, any> = {};

    if (mapping && mapping.__parents === '__forward' && nodeDef && Array.isArray(nodeDef.parents)) {
        for (const p of nodeDef.parents) {
            const parentOut = nodeOutputs[p];
            if (parentOut && typeof parentOut === 'object') {
                for (const k of Object.keys(parentOut)) {
                    if (!mapped.hasOwnProperty(k)) {
                        mapped[k] = parentOut[k];
                    }
                }
            }
        }
    }

    for (const key of Object.keys(mapping || {})) {
        if (key === '__parents') {
            continue;
        }
        mapped[key] = mapInputValue(mapping[key], triggerOutputs, nodeOutputs, parentCombined, wf);
    }
    return mapped;
}

/**
 * Compute which actions are reachable from a set of starting node names.
 * The actionsList is scanned for `parents` arrays and a children map
 * is built (parent -> [children]). A BFS from `startingNodes` then
 * collects reachable action names.
 *
 * @param actionsList - list of actions (each may include `parents` and `name`)
 * @param startingNodes - set of starting node names
 * @returns Set of reachable action names
 */
export function computeReachableActions(actionsList: any[], startingNodes: Set<string>) {
    const childrenMap: Record<string, string[]> = {};
    for (const a of actionsList) {
        if (!a || !a.name) {
            continue;
        }
    }
    for (const a of actionsList) {
        if (!a || !a.name) {
            continue;
        }
        const parents = Array.isArray(a.parents) ? a.parents : [];
        for (const p of parents) {
            if (!childrenMap[p]) {
                childrenMap[p] = [];
            }
            childrenMap[p].push(a.name);
        }
    }

    const reachable = new Set<string>();
    const q: string[] = Array.from(startingNodes);
    while (q.length > 0) {
        const cur = q.shift() as string;
        const children = childrenMap[cur] || [];
        for (const c of children) {
            if (!reachable.has(c)) {
                reachable.add(c);
                q.push(c);
            }
        }
    }

    return reachable;
}

/**
 * Merge outputs from an array of parent node names. First-seen keys win.
 * @param parents - array of parent node names
 * @param nodeOutputs - map of node outputs
 * @returns merged parentCombined object or null
 */
function mergeParentOutputs(parents: string[] | undefined, nodeOutputs: Record<string, any>) {
    if (!Array.isArray(parents)) return null;
    const parentCombined: Record<string, any> = {};
    for (const p of parents) {
        const po = nodeOutputs[p];
        if (po && typeof po === 'object') {
            for (const k of Object.keys(po)) {
                if (!(k in parentCombined)) {
                    parentCombined[k] = po[k];
                }
            }
        }
    }
    return parentCombined;
}

/**
 * Resolve credentials for a node using options.getCredentialById when available.
 * @param credentialId - credential identifier
 * @param wf - workflow object
 * @param options - options which may contain `getCredentialById`
 * @param reqOrCtx - request/context passed to getCredentialById
 * @returns credentials object
 */
async function resolveCredentialsForNode(credentialId: any, wf: any, options: any, reqOrCtx: any) {
    const credentials: Record<string, any> = {};
    if (!credentialId || typeof options?.getCredentialById !== 'function') return credentials;
    try {
        const resolved = options.getCredentialById(credentialId, reqOrCtx);
        const r = resolved && resolved.then ? await resolved : resolved;
        if (r) {
            if (r.type && r.data) {
                credentials[r.type] = r.data;
            } else {
                for (const k of Object.keys(r)) {
                    credentials[k] = r[k];
                }
            }
        }
    } catch (e) {
        console.error('getCredentialById error', e);
    }
    return credentials;
}

/**
 * Compute node final outputs by evaluating any declared output templates.
 * @param node - node definition
 * @param result - result returned from runAction
 * @param mappedInputs - inputs passed to action
 * @param nodeOutputs - accumulated node outputs so far
 * @param parentCombined - merged parent outputs
 * @param triggerOutputs - trigger outputs (body/params/query)
 * @param wf - workflow object
 * @returns computed finalOutputs object
 */
function computeFinalOutputs(node: any, result: any, mappedInputs: Record<string, any>, nodeOutputs: Record<string, any>, parentCombined: Record<string, any> | null, triggerOutputs: any, wf?: any) {
    let finalOutputs: any = result || {};
    if (node.outputs && typeof node.outputs === 'object') {
        const evalContext = {
            body: mappedInputs['body'] || triggerOutputs.body,
            params: mappedInputs['params'] || triggerOutputs.params,
            query: mappedInputs['query'] || triggerOutputs.query,
            nodes: nodeOutputs,
            inputs: mappedInputs,
            parent: parentCombined || {}
        };

        finalOutputs = finalOutputs || {};
        for (const k of Object.keys(node.outputs)) {
            const val = node.outputs[k];
            if (typeof val !== 'string') {
                finalOutputs[k] = val;
                continue;
            }
            const s = val.trim();
            if (!s.startsWith('${{') || !s.endsWith('}}')) {
                finalOutputs[k] = val;
                continue;
            }
            const expr = s.slice(3, -2).trim();
            const v = evaluateTemplateWithFallback(expr, wf, { body: evalContext.body, params: evalContext.params, query: evalContext.query, nodes: evalContext.nodes, parent: evalContext.parent, inputs: evalContext.inputs });
            finalOutputs[k] = v === undefined ? null : v;
        }
    }
    return finalOutputs;
}

/**
 * Execute the provided actions list in order.
 *
 * The executor:
 * - Seeds `nodeOutputs` with `initialNodeOutputs`.
 * - Computes reachable actions from those starting nodes and skips unreachable ones.
 * - For each reachable action:
 *   - Builds `parentCombined` by merging parent outputs (first-seen wins)
 *   - Resolves mapped inputs via `buildMappedInputs`
 *   - Resolves credentials via `options.getCredentialById` if available
 *   - Finds the action implementation in `registry` using `findActionInRegistry`
 *   - Calls `runAction(actionObj, mappedInputs, { credentials, previousOutputs })`
 *   - Evaluates declared `node.outputs` templates (if any) and merges them into finalOutputs
 *
 * Returns a map of nodeName -> outputs for all processed nodes.
 */
export async function executeActions(actionsList: any[], reqOrCtx: any, triggerOutputs: any, initialNodeOutputs: Record<string, any> = {}, wf?: any, registry?: any, options?: any) {
    /**
     * Execute actions sequentially using smaller helper functions.
     * @returns map of nodeName -> outputs
     */
    const nodeOutputs: Record<string, any> = { ...(initialNodeOutputs || {}) };

    const startingNodes = new Set<string>(Object.keys(initialNodeOutputs || {}));
    const reachable = computeReachableActions(actionsList, startingNodes);

    for (let idx = 0; idx < actionsList.length; idx++) {
        const node = actionsList[idx];
        if (!node || !node.name) continue;

        if (!reachable.has(node.name)) {
            nodeOutputs[node.name] = nodeOutputs[node.name] || {};
            continue;
        }

        const parentCombined = mergeParentOutputs(node.parents, nodeOutputs);

        const mappedInputs = buildMappedInputs(node.inputs || {}, triggerOutputs, nodeOutputs, node, parentCombined, wf);

        const credentialId = node.credential_id || wf?.credential_id;
        const credentials = await resolveCredentialsForNode(credentialId, wf, options, reqOrCtx);

        const actionObj = registry ? findActionInRegistry(registry, node.id) : null;
        if (!actionObj) {
            const err: any = new Error(`action ${node.id} not found`);
            err.httpStatus = 404;
            throw err;
        }

        const result = await runAction(actionObj, mappedInputs, { credentials, previousOutputs: nodeOutputs });

        const finalOutputs = computeFinalOutputs(node, result, mappedInputs, nodeOutputs, parentCombined, triggerOutputs, wf);

        nodeOutputs[node.name] = finalOutputs || {};
    }

    return nodeOutputs;
}

/**
 * Find an action implementation inside a registry object.
 * Registry shape is expected to be: { modules: { modName: { actions: { [id]: actionObj }}}}
 *
 * @param registry - registry object containing modules and actions
 * @param actionId - action identifier to find
 * @returns the action implementation object or null
 */
function findActionInRegistry(registry: any, actionId: string) {
    for (const modName of Object.keys(registry.modules || {})) {
        const mod = registry.modules[modName];
        if (!mod.actions) {
            continue;
        }
        if (mod.actions[actionId]) {
            return mod.actions[actionId];
        }
    }
    return null;
}
