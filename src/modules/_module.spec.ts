/**
 * Describe a single input/output field used by actions and credentials.
 * @interface Field
 * @property {string} id - unique field identifier
 * @property {string} pretty_name - human readable label shown in UIs
 * @property {'string'|'number'|'boolean'|'json'|'select'} type - field data type
 * @property {boolean} [required] - whether the field is required
 * @property {*} [default] - optional default value for the field
 * @property {Array<{label: string, value:any}>} [options] - options for `select` fields
 */
export interface Field {
    id: string;
    pretty_name: string;
    type: 'string' | 'number' | 'boolean' | 'json' | 'select';
    required?: boolean;
    default?: any;
    options?: Array<{ label: string; value: any }>;
}

/**
 * Definition of a credential type exposed by a module.
 * @interface CredentialDef
 * @property {string} [id] - optional credential id (module-assigned)
 * @property {string} pretty_name - human readable name for the credential
 * @property {Field[]} fields - list of fields required to configure this credential
 */
export interface CredentialDef {
    id?: string;
    pretty_name: string;
    fields: Field[];
}

/**
 * Specification for an action provided by a module.
 * @interface ActionSpec
 * @property {string} id - unique action identifier
 * @property {string} pretty_name - display name
 * @property {string} [description] - optional long description
 * @property {string} [credential_type] - required credential type id
 * @property {Field[]} [inputs] - inputs accepted by the action
 * @property {Field[]} [outputs] - outputs produced by the action
 * @property {(ctx: ActionContext, inputs: Record<string, any>) => Promise<Record<string, any>>} handler - implementation entrypoint
 */
export interface ActionSpec {
    id: string;
    pretty_name: string;
    description?: string;
    credential_type?: string;
    inputs?: Field[];
    outputs?: Field[];
    handler: (ctx: ActionContext, inputs: Record<string, any>) => Promise<Record<string, any>>
}

/**
 * Basic metadata describing a module.
 * @interface ModuleInfo
 * @property {string} [id] - optional module id
 * @property {string} pretty_name - human friendly module name
 * @property {string} [description] - optional description
 */
export interface ModuleInfo {
    id?: string;
    pretty_name: string;
    description?: string;
}

/**
 * Execution context passed to action handlers.
 * @interface ActionContext
 * @property {(type: string) => Promise<Record<string, any> | null>} getCredential - fetch credential by type
 * @property {{info: Function, warn: Function, error: Function}} logger - simple logger
 * @property {(nodeId: string, key?: string) => any} getNodeOutput - read another node's outputs
 * @property {Record<string, any>} nodeOutputs - aggregated node outputs during execution
 */
export interface ActionContext {
    getCredential: (type: string) => Promise<Record<string, any> | null>;
    logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void };
    getNodeOutput: (nodeId: string, key?: string) => any;
    nodeOutputs: Record<string, any>;
}

/**
 * Internal representation of an action registered by a module loader.
 * @interface RegisteredAction
 * @property {ActionSpec} spec - the action specification
 * @property {(ctx: ActionContext, inputs: Record<string, any>) => Promise<Record<string, any>>} handler - execution function
 */
export interface RegisteredAction {
    spec: ActionSpec;
    handler: (ctx: ActionContext, inputs: Record<string, any>) => Promise<Record<string, any>>;
}
