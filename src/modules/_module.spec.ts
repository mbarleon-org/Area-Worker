export interface Field {
    id: string;
    pretty_name: string;
    type: 'string' | 'number' | 'boolean' | 'json' | 'select';
    required?: boolean;
    default?: any;
    options?: Array<{ label: string; value: any }>;
}

export interface CredentialDef {
    id?: string;
    pretty_name: string;
    fields: Field[];
}

export interface ActionSpec {
    id: string;
    pretty_name: string;
    description?: string;
    credential_type?: string;
    inputs?: Field[];
    outputs?: Field[];
    handler: (ctx: ActionContext, inputs: Record<string, any>) => Promise<Record<string, any>>
}

export interface ModuleInfo {
    id?: string;
    pretty_name: string;
    description?: string;
}

export interface ActionContext {
    getCredential: (type: string) => Promise<Record<string, any> | null>;
    logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void };
    getNodeOutput: (nodeId: string, key?: string) => any;
    nodeOutputs: Record<string, any>;
}

export interface RegisteredAction {
    spec: ActionSpec;
    handler: (ctx: ActionContext, inputs: Record<string, any>) => Promise<Record<string, any>>;
}
