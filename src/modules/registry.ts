export { };
const fs = require('fs');
const path = require('path');

function tryRequire(fp) {
    try {
        return require(fp);
    } catch (e) {
        if (fp.endsWith('.ts')) {
            try { return require(fp.replace(/\.ts$/, '.js')); } catch (e2) { /* ignore */ }
        } else if (fp.endsWith('.js')) {
            try { return require(fp.replace(/\.js$/, '.ts')); } catch (e2) { /* ignore */ }
        }
        throw e;
    }
}

function loadModules(baseDir) {
    const modulesDir = path.resolve(baseDir);
    const modules = {};

    if (!fs.existsSync(modulesDir)) return { modules };

    for (const name of fs.readdirSync(modulesDir)) {
        const modulePath = path.join(modulesDir, name);
        if (!fs.statSync(modulePath).isDirectory()) continue;

        const mod = { info: null, credentials: {}, actions: {} };

        const infoFile = path.join(modulePath, 'infos.ts');
        if (fs.existsSync(infoFile)) {
            try {
                mod.info = tryRequire(infoFile);
            } catch (e) { }
        }

        const credDir = path.join(modulePath, 'credentials');
        if (fs.existsSync(credDir)) {
            for (const f of fs.readdirSync(credDir)) {
                const fp = path.join(credDir, f);
                if (!fs.statSync(fp).isFile()) continue;
                try {
                    const exported = tryRequire(fp) || {};
                    const exportedId = exported.id || path.basename(f, path.extname(f));
                    let finalId;
                    if (exportedId.indexOf('.') !== -1) {
                        finalId = exportedId;
                    } else {
                        const prefix = (mod.info && mod.info.id) ? mod.info.id : name;
                        finalId = `${prefix}.${exportedId}`;
                    }
                    mod.credentials[finalId] = { ...exported, id: finalId };
                } catch (e) { }
            }
        }

        const actionsDir = path.join(modulePath, 'actions');
        if (fs.existsSync(actionsDir)) {
            for (const f of fs.readdirSync(actionsDir)) {
                const fp = path.join(actionsDir, f);
                if (!fs.statSync(fp).isFile()) continue;
                try {
                    const exported = tryRequire(fp);
                    const spec = exported && exported.spec ? exported.spec : exported;
                    let id;
                    if (spec && spec.id) {
                        if (spec.id.indexOf('.') !== -1) {
                            id = spec.id;
                        } else {
                            const prefix = (mod.info && mod.info.id) ? mod.info.id : name;
                            id = `${prefix}.${spec.id}`;
                        }
                    } else {
                        id = `${name}.${path.basename(f, path.extname(f))}`;
                    }
                    const handler = spec.handler || exported.handler || exported.function;
                    if (!handler) continue;
                    mod.actions[id] = { spec: { ...spec, id }, handler };
                } catch (e) {
                    console.error('failed loading action', fp, e.message);
                }
            }
        }

        modules[name] = mod;
    }

    return { modules };
}

function findAction(registry, actionId) {
    for (const modName of Object.keys(registry.modules || {})) {
        const mod = registry.modules[modName];
        if (mod.actions && mod.actions[actionId]) return mod.actions[actionId];
    }
    return null;
}

module.exports = { loadModules, findAction };
