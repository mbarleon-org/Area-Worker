const { runAction } = require('../modules/runner');

function isValidIdentifier(s: string) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
}

export function evalTemplateAsJS(expr: string, wf: any, env: { body?: any; params?: any; query?: any; nodes?: Record<string, any>; parent?: any; inputs?: any; }) {
    const nodes = env.nodes || {};
    const paramNames: string[] = ['wf', 'body', 'params', 'query', 'parent', 'inputs', 'nodes'];
    const paramValues: any[] = [wf, env.body, env.params, env.query, env.parent, env.inputs, env.nodes];

    const declaredNames = new Set<string>();
    try {
        for (const t of (wf.triggers || [])) if (t && t.name) {
            declaredNames.add(t.name);
        }
        for (const a of (wf.actions || [])) if (a && a.name) {
            declaredNames.add(a.name);
        }
    } catch (e) { }
    for (const k of Object.keys(nodes || {})) {
        declaredNames.add(k);
    }

    for (const name of Array.from(declaredNames)) {
        if (isValidIdentifier(name)) {
            paramNames.push(name);
            paramValues.push((nodes || {})[name]);
        }
    }

    const fn = new Function(...paramNames, `return (${expr});`);
    return fn(...paramValues);
}

export function mapInputValue(pathSpec: string, triggerOutputs: any, nodeOutputs: Record<string, any>, parentCombined: Record<string, any> | null = null, wf?: any) {
    const spec = (pathSpec || '');
    if (typeof spec === 'string') {
        const s = spec.trim();
        if (s.startsWith('${{') && s.endsWith('}}')) {
            const exprRaw = s.slice(3, -2).trim();
            try {
                const res = evalTemplateAsJS(exprRaw, wf, { body: triggerOutputs.body, params: triggerOutputs.params, query: triggerOutputs.query, nodes: nodeOutputs, parent: parentCombined || {} });
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
    }

    const parts = String(spec).split('.');
    if (!parts[0]) {
        return undefined;
    }

    if (nodeOutputs && Object.prototype.hasOwnProperty.call(nodeOutputs, parts[0])) {
        let val: any = nodeOutputs[parts[0]];
        for (let i = 1; val !== undefined && i < parts.length; i++) {
            val = val[parts[i]];
        }
        return val;
    }

    if (parts[0] === 'parent' && parentCombined) {
        let val: any = parentCombined[parts[1]];
        for (let i = 2; val !== undefined && i < parts.length; i++) {
            val = val[parts[i]];
        }
        return val;
    }

    let val: any;
    if (parts[0] === 'body') {
        val = triggerOutputs.body;
    } else if (parts[0] === 'params') {
        val = triggerOutputs.params;
    } else if (parts[0] === 'query') {
        val = triggerOutputs.query;
    } else if (parts[0] === 'nodes') {
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

export async function executeActions(actionsList: any[], reqOrCtx: any, triggerOutputs: any, initialNodeOutputs: Record<string, any> = {}, wf?: any, registry?: any, options?: any) {
    const nodeOutputs: Record<string, any> = { ...(initialNodeOutputs || {}) };

    const startingNodes = new Set<string>(Object.keys(initialNodeOutputs || {}));
    const reachable = computeReachableActions(actionsList, startingNodes);

    for (let idx = 0; idx < actionsList.length; idx++) {
        const node = actionsList[idx];
        if (!node || !node.name) {
            continue;
        }
        if (!reachable.has(node.name)) {
            nodeOutputs[node.name] = nodeOutputs[node.name] || {};
            continue;
        }

        let parentCombined: Record<string, any> | null = null;
        if (node && Array.isArray(node.parents)) {
            parentCombined = {};
            for (const p of node.parents) {
                const po = nodeOutputs[p];
                if (po && typeof po === 'object') {
                    for (const k of Object.keys(po)) {
                        if (!(k in parentCombined)) {
                            parentCombined[k] = po[k];
                        }
                    }
                }
            }
        }

        const mappedInputs = buildMappedInputs(node.inputs || {}, triggerOutputs, nodeOutputs, node, parentCombined, wf);

        const credentials: Record<string, any> = {};
        const credentialId = node.credential_id || wf.credential_id;
        if (credentialId && typeof options?.getCredentialById === 'function') {
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
        }

        const actionObj = registry ? findActionInRegistry(registry, node.id) : null;
        if (!actionObj) {
            const err: any = new Error(`action ${node.id} not found`);
            err.httpStatus = 404;
            throw err;
        }

        const result = await runAction(actionObj, mappedInputs, { credentials, previousOutputs: nodeOutputs });

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

            const evaluate = (val: any) => {
                if (typeof val !== 'string') {
                    return val;
                }
                val = val.trim();
                if (!val.startsWith('${{') || !val.endsWith('}}')) {
                    return val;
                }
                let expr = val.slice(3, -2).trim();
                try {
                    const res = evalTemplateAsJS(expr, wf, { body: evalContext.body, params: evalContext.params, query: evalContext.query, nodes: evalContext.nodes, parent: evalContext.parent, inputs: evalContext.inputs });
                    if (res === undefined || res === null || (typeof res === 'string' && res === '')) {
                        const m = expr.match(/\|\|\s*(['"])(.*?)\1\s*$/);
                        if (m) {
                            return m[2];
                        }
                    }
                    return res;
                } catch (e) {
                    try {
                        const m = expr.match(/\|\|\s*(['"])(.*?)\1/);
                        if (m) {
                            return m[2];
                        }
                    } catch (e2) { }
                    return null;
                }
            };

            finalOutputs = finalOutputs || {};
            for (const k of Object.keys(node.outputs)) {
                finalOutputs[k] = evaluate(node.outputs[k]);
            }
        }

        nodeOutputs[node.name] = finalOutputs || {};
    }

    return nodeOutputs;
}

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
