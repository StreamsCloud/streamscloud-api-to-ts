"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const prettier = require("prettier");
const utils_1 = require("./utils");
class OpenApiToTs {
    constructor(namespacePrefix) {
        this.namespacePrefix = namespacePrefix;
        this.polymorphicTypes = [];
        this.polymorphicTypesWithBase = [];
        this.generateDeclaringTypeSchemaString = (typeDefinition) => {
            switch (typeDefinition.type) {
                case OPEN_API_TYPES.object:
                    return this.generateInterfaceSchema(typeDefinition);
                case OPEN_API_TYPES.enum:
                    return this.generateEnumSchemaString(typeDefinition);
                default: {
                    typeDefinition.schemaString = `/*
                 * Error parsing object ${typeDefinition.originalName}: Unknown type
                 */`;
                }
            }
        };
        this.generateInterfaceSchema = (typeDefinition, generateAnonymousType = false) => {
            const extendsTypes = [];
            if (Array.isArray(typeDefinition.allOf)) {
                typeDefinition.allOf.forEach(def => {
                    if (def.$ref) {
                        extendsTypes.push(this.typeToString(def));
                    }
                });
            }
            const extendsString = extendsTypes.length ? ` extends ${extendsTypes.join(', ')}` : '';
            const explicitInterfaceHeader = generateAnonymousType ? '' : `export interface ${typeDefinition.name} ${extendsString}`;
            const header = `${explicitInterfaceHeader}{`;
            let sb;
            try {
                sb = [header];
                typeDefinition.properties.forEach(property => {
                    const readonlyPrefix = property.readOnly ? 'readonly ' : '';
                    const optional = !Array.isArray(typeDefinition.required) || typeDefinition.required.indexOf(property.propertyName) === -1;
                    const propName = `${property.propertyName}${optional ? '?' : ''}`;
                    const propType = this.typeToString(property);
                    if (typeof property.description === 'string') {
                        sb.push(`/**\n* ${property.description.replace(/\n$/, '').replace(/\n/g, '\n* ')}\n*/`);
                    }
                    const defaultValue = property.default ? `.${property.default}` : '';
                    const comments = [];
                    if (!generateAnonymousType) {
                        if (property.format)
                            comments.push(property.format);
                        if (property.nullable)
                            comments.push('nullable');
                    }
                    const commentsString = comments.length ? `// ${comments.join(', ')}` : '';
                    sb.push(`${readonlyPrefix}${propName}: ${propType}${defaultValue}; ${commentsString}`);
                });
            }
            catch (e) {
                sb = [header];
                sb.push(`/*
                    *${e.toString()}
                    */`);
                sb.push('[name: string]: any');
            }
            sb.push('}');
            const separator = generateAnonymousType ? '' : '\n';
            typeDefinition.schemaString = sb.join(separator);
        };
        this.generateEnumSchemaString = (typeDefinition) => {
            const header = `export enum ${typeDefinition.name} {`;
            let sb;
            try {
                sb = [header];
                sb.push(typeDefinition.enum.map(value => (`${value} = '${value}'`)).join(',\n'));
            }
            catch (e) {
                sb = [header];
                sb.push(`/*
                    *${e.toString()}
                    */`);
            }
            sb.push('}');
            typeDefinition.schemaString = sb.join('\n');
        };
        this.generateEndpointStringRepresentation = (endpoint) => {
            var _a, _b;
            const sb = [`// ${endpoint.template}`];
            const methodParamParts = [];
            let body = null;
            if (endpoint.requestBody && endpoint.requestBody.content) {
                const entries = Object.entries(endpoint.requestBody.content);
                const jsonModel = entries.find(([mimeType]) => mimeType === 'application/json');
                if (jsonModel) {
                    body = {
                        paramName: 'payload',
                        isFormData: false,
                        schema: this.typeToString(jsonModel[1]['schema'])
                    };
                }
                const formModel = entries.find(([mimeType]) => mimeType === 'multipart/form-data');
                if (formModel) {
                    const properties = this.parseObjectProperties(formModel[1]['schema']);
                    const complexPropertyTypes = (_a = endpoint.parameters, (_a !== null && _a !== void 0 ? _a : []));
                    endpoint.parameters = null;
                    complexPropertyTypes.forEach(paramDef => {
                        const newProp = paramDef.schema;
                        newProp.propertyName = paramDef.name;
                        properties.push(newProp);
                    });
                    const anonymousTypeDefinition = {
                        originalName: 'anonymous',
                        name: 'anonymous',
                        namespace: null,
                        properties
                    };
                    this.generateInterfaceSchema(anonymousTypeDefinition, true);
                    body = { paramName: 'formModel', isFormData: true, schema: anonymousTypeDefinition.schemaString };
                }
            }
            if (body) {
                methodParamParts.push(`${body.paramName}: ${body.schema}`);
            }
            const queryParams = (_b = endpoint.parameters, (_b !== null && _b !== void 0 ? _b : [])).filter(p => p.in === 'query');
            if (queryParams.length) {
                queryParams.forEach(param => {
                    const optionalMark = param.required ? '' : '?';
                    methodParamParts.push(`${param.name}${optionalMark}: ${this.typeToString(param.schema)}`);
                });
            }
            const responseType = this.getResponseType(endpoint);
            sb.push(`public ${endpoint.name}(${methodParamParts.join(', ')}):Promise<${(responseType !== null && responseType !== void 0 ? responseType : 'void')}>{`);
            const dcMethodParams = [`'${endpoint.url}'`];
            let payloadGeneration = '';
            if (endpoint.method !== 'get') {
                if (body) {
                    if (body.isFormData) {
                        const paramName = 'formData';
                        const formSb = [];
                        formSb.push(`const ${paramName} = new FormData();`);
                        formSb.push(`Object.entries(${body.paramName}).forEach(([key, value])=>{`);
                        formSb.push(`if (value instanceof Blob) {`);
                        formSb.push(`${paramName}.append(key, value);`);
                        formSb.push(`} else if (`);
                        formSb.push(`Array.isArray(value) && value.length && value[0] instanceof Blob`);
                        formSb.push(`){`);
                        formSb.push(`for (let blob of value as Blob[]) {`);
                        formSb.push(`${paramName}.append(key, blob);`);
                        formSb.push(`}`);
                        formSb.push(`} else {`);
                        formSb.push(`${paramName}.append(key, JSON.stringify(value));`);
                        formSb.push(`}`);
                        formSb.push('});');
                        payloadGeneration = formSb.join('\n');
                        dcMethodParams.push(paramName);
                    }
                    else {
                        dcMethodParams.push(body.paramName);
                    }
                }
                else {
                    dcMethodParams.push('null');
                }
            }
            let paramsGeneration = null;
            if (queryParams.length) {
                const paramName = 'params';
                const paramsSb = [];
                const requiredParams = queryParams.filter(p => p.required);
                paramsSb.push(`const ${paramName} = {${requiredParams.map(p => p.name).join(', ')}};`);
                const optionalParams = queryParams.filter(p => !p.required);
                optionalParams.forEach(param => {
                    paramsSb.push(`if(${param.name}!==undefined){
                    ${paramName}['${param.name}'] = ${param.name};
                }`);
                });
                paramsGeneration = paramsSb.join('\n');
                dcMethodParams.push(paramName);
            }
            if (payloadGeneration) {
                sb.push(payloadGeneration);
            }
            if (paramsGeneration) {
                sb.push(paramsGeneration);
            }
            sb.push(`return this.dc.${endpoint.method}(${dcMethodParams.join(', ')});`);
            sb.push('}');
            endpoint.stringRepresentation = sb.join('\n');
        };
        this.getResponseType = (endpoint) => {
            const types = [];
            const responses = Object.entries(endpoint.responses);
            responses.forEach(([code, body]) => {
                const statusCode = parseInt(code);
                if (statusCode < 200 || statusCode >= 300 || !body.content)
                    return;
                const entries = Object.entries(body.content);
                const jsonModel = entries.find(([mimeType]) => mimeType === 'application/json');
                if (!jsonModel || !jsonModel[1]['schema'])
                    return;
                types.push(this.typeToString(jsonModel[1]['schema']));
            });
            if (!types.length)
                return 'void';
            return types.join(' | ');
        };
        this.typeToString = (definition) => {
            if (!definition)
                return '';
            const originalIsNullable = definition.nullable;
            definition.nullable = false;
            const getRefName = (lookup) => lookup.replace('#/components/schemas/', '');
            const getRef = (lookup) => this.allTypes.find(t => t.originalName === getRefName(lookup));
            const getQualifiedName = (ref) => `${ref.namespace}.${ref.name}`;
            const getAllOfRef = () => Array.isArray(definition.allOf) && definition.allOf.length && definition.allOf[0].$ref;
            const isBinary = (def) => def.format === 'binary';
            // REF: defined reference type
            const $ref = definition.$ref ?
                // case of polymorphic behaviour (oneOf)
                definition.$ref :
                // general case, when type of property is reference type
                !Array.isArray(definition.oneOf) && getAllOfRef();
            if ($ref) {
                const ref = getRef($ref);
                if (ref.namespace === this.getNamespace(NAMESPACES.$enums)) {
                    definition.nullable = originalIsNullable;
                }
                return getQualifiedName(ref);
            }
            // ARRAY: any array type
            if (definition.items) {
                if (definition.items.$ref) {
                    const ref = getRef(definition.items.$ref);
                    return `${getQualifiedName(ref)}[]`;
                }
                if (definition.items.type) {
                    if (definition.items.type === OPEN_API_TYPES.array) {
                        return `${this.typeToString(definition.items)}[]`;
                    }
                    if (definition.items.type === OPEN_API_TYPES.object) {
                        return `${this.typeToString(definition.items)}[]`;
                    }
                    if (isBinary(definition.items)) {
                        return `${PROP_TYPES_MAP.binary}[]`;
                    }
                    if (PROP_TYPES_MAP[definition.items.type]) {
                        return `${PROP_TYPES_MAP[definition.items.type]}[]`;
                    }
                }
                if (definition.items.oneOf) {
                    const stringRepresentation = this.typeToString(definition.items);
                    return stringRepresentation.includes('|') ? `Array<${stringRepresentation}>` : `${stringRepresentation}[]`;
                }
            }
            // Polymorphic type
            if (Array.isArray(definition.oneOf)) {
                const getDerivedTypesString = () => definition.oneOf.map((def) => this.typeToString(def)).join(' | ');
                if (definition.properties && definition.properties.parent) {
                    const typeName = getRefName(definition.properties.parent.$ref);
                    let polyDefinition = this.polymorphicTypes.find(t => t.originalName == typeName);
                    if (!polyDefinition) {
                        const sanitizedName = `${this.sanitizeTypeName(typeName)}Type`;
                        polyDefinition = {
                            originalName: typeName,
                            name: sanitizedName,
                            namespace: this.getNamespace(NAMESPACES.$types),
                            schemaString: `export type ${sanitizedName} = ${getDerivedTypesString()}`
                        };
                        this.polymorphicTypes.push(polyDefinition);
                    }
                    const allOfRef = getAllOfRef();
                    if (allOfRef) {
                        const polyTypeWithBase = this.polymorphicTypesWithBase.find(t => t.typeName == typeName);
                        if (!polyTypeWithBase) {
                            this.polymorphicTypesWithBase.push({
                                typeName: typeName,
                                baseTypeName: getRefName(allOfRef)
                            });
                        }
                    }
                    return getQualifiedName(polyDefinition);
                }
                return getDerivedTypesString();
            }
            // DICTIONARY
            if (definition.type === OPEN_API_TYPES.object && definition.additionalProperties) {
                const recordType = (type) => `Record<string, ${type}>`;
                if (definition.additionalProperties === true) {
                    return recordType('any');
                }
                if (definition.additionalProperties.type || definition.additionalProperties.oneOf) {
                    const type = this.typeToString(definition.additionalProperties);
                    return recordType(type);
                }
                if (definition.additionalProperties.$ref) {
                    const ref = getRef(definition.additionalProperties.$ref);
                    return recordType(getQualifiedName(ref));
                }
            }
            // PRIMITIVE TYPE: one of known primitive types
            if (PROP_TYPES_MAP[definition.type]) {
                let parsedType = PROP_TYPES_MAP[definition.type];
                if ([PROP_TYPES_MAP.number, PROP_TYPES_MAP.integer, PROP_TYPES_MAP.boolean].includes(parsedType)) {
                    definition.nullable = originalIsNullable;
                }
                if (parsedType === PROP_TYPES_MAP.string && definition.format) {
                    definition.nullable = originalIsNullable;
                    if (isBinary(definition)) {
                        parsedType = PROP_TYPES_MAP.binary;
                    }
                }
                return parsedType;
            }
            // FALLBACK
            return 'unknown';
        };
        this.parseObjectProperties = (input, requiredList) => {
            if (!input.properties)
                return [];
            const defs = Object.entries(input.properties).map(([key, propDefinition]) => {
                const prop = { propertyName: key };
                Object.assign(prop, propDefinition);
                return prop;
            });
            if (requiredList) {
                const orderedRequiredList = [];
                defs.forEach(def => {
                    const defInRequired = requiredList.find(propName => propName === def.propertyName);
                    if (defInRequired) {
                        orderedRequiredList.push(defInRequired);
                    }
                });
                orderedRequiredList.forEach((propName, index) => {
                    const requiredPropIndex = defs.findIndex(def => def.propertyName === propName);
                    if (requiredPropIndex >= 0) {
                        const propDef = defs[requiredPropIndex];
                        defs.splice(requiredPropIndex, 1);
                        defs.splice(index, 0, propDef);
                    }
                });
            }
            return defs;
        };
        this.sanitizeTypeName = (typeName) => typeName
            .replace(/DTO$/i, '')
            .replace(/Request$/i, '')
            .replace(/Response$/i, '')
            .replace(/Input$/i, '')
            .replace(/Output$/i, '');
        this.updatePolyTypesWithBase = () => {
            if (!this.polymorphicTypesWithBase)
                return;
            this.polymorphicTypesWithBase.forEach(ptwb => {
                const polyType = this.allTypes.find(t => t.originalName === ptwb.typeName);
                const baseType = this.allTypes.find(t => t.originalName === ptwb.baseTypeName);
                polyType.allOf = [{ $ref: baseType.originalName }];
                baseType.properties.forEach(prop => {
                    const index = polyType.properties.findIndex(p => p.propertyName === prop.propertyName);
                    if (index >= 0) {
                        polyType.properties.splice(index, 1);
                    }
                });
                this.generateDeclaringTypeSchemaString(polyType);
            });
        };
        this.getNamespace = (namespace) => {
            let parsedNamespace = namespace.toString();
            if (this.namespacePrefix) {
                parsedNamespace = `${this.namespacePrefix}${utils_1.Utils.toUpperCamelCase(namespace)}`;
            }
            return `$${parsedNamespace}`;
        };
    }
    parse(spec, isTest) {
        const tsIgnore = isTest ? '\n// @ts-ignore' : '';
        const output = [`
/**
 * This file was auto-generated.
 * Do not make direct changes to the file.
 */${tsIgnore}
 import { autoinject } from 'aurelia-framework';${tsIgnore}
 import { DataContext } from 'resources/utils/data-context';
`];
        try {
            const schemas = spec.components.schemas;
            this.allTypes = !schemas ? [] : Object.entries(schemas).map(([typeName, typeDefinition]) => {
                const getNamespace = () => {
                    if (typeDefinition.type !== OPEN_API_TYPES.object)
                        return this.getNamespace(NAMESPACES.$enums);
                    if (typeName.endsWith('Request') || typeName.endsWith('Input'))
                        return this.getNamespace(NAMESPACES.$inputs);
                    if (typeName.endsWith('Response') || typeName.endsWith('Output'))
                        return this.getNamespace(NAMESPACES.$outputs);
                    return this.getNamespace(NAMESPACES.$models);
                };
                if (!typeDefinition.type) {
                    typeDefinition.type = OPEN_API_TYPES.object;
                }
                const definition = {
                    originalName: typeName,
                    name: this.sanitizeTypeName(typeName),
                    namespace: getNamespace()
                };
                Object.assign(definition, typeDefinition);
                if (definition.enum) {
                    definition.type = OPEN_API_TYPES.enum;
                    if (!definition.name.endsWith('Enum')) {
                        definition.name = definition.name + 'Enum';
                    }
                }
                else if (definition.type === OPEN_API_TYPES.object) {
                    // parse object properties
                    definition.properties = this.parseObjectProperties(typeDefinition, definition.required);
                }
                else {
                    definition.type = 'unknown';
                }
                return definition;
            });
        }
        catch (e) {
            console.error('Types error' + e.toString());
        }
        this.allTypes.sort((a, b) => a.name.localeCompare(b.name));
        this.allTypes.forEach(this.generateDeclaringTypeSchemaString);
        try {
            const paths = spec.paths;
            this.endpoints = Object.entries(paths).map(([eTemplate, eDefinition]) => {
                const templateParts = eTemplate.slice(1).split('/').filter(p => !!p && !p.includes('{'));
                const controller = templateParts[0];
                if (!controller)
                    return null;
                const [method, description] = Object.entries(eDefinition)[0];
                const nameParts = templateParts.slice(1);
                const name = nameParts.length ? nameParts.map(p => utils_1.Utils.toUpperCamelCase(p)).join('') : method;
                const definition = {
                    template: `${method.toUpperCase()} ${eTemplate}`,
                    name: utils_1.Utils.toCamelCase(name),
                    controller,
                    method,
                    url: templateParts.map(p => utils_1.Utils.toCamelCase(p)).join('/')
                };
                Object.assign(definition, description);
                return definition;
            }).filter(e => e);
        }
        catch (e) {
            console.error('Endpoints error: ' + e.toString());
        }
        this.endpoints.sort((a, b) => a.name.localeCompare(b.name));
        this.endpoints.forEach(this.generateEndpointStringRepresentation);
        output.push(`/* eslint-disable @typescript-eslint/no-namespace */
    export namespace ${this.getNamespace(NAMESPACES.$api)}{`);
        const endpointGroups = utils_1.Utils.groupBy(this.endpoints, x => x.controller);
        endpointGroups.sort((a, b) => a.key.localeCompare(b.key));
        endpointGroups.forEach(g => {
            output.push(`
@autoinject()
export class ${g.key} {
  constructor(private dc: DataContext) {
  }
  ${g.values.map(v => v.stringRepresentation).join('\n\n')}
  }
`);
        });
        output.push('}');
        this.updatePolyTypesWithBase();
        const modelGroups = utils_1.Utils.groupBy(this.allTypes, x => x.namespace);
        modelGroups.sort((a, b) => a.key.localeCompare(b.key));
        modelGroups.forEach(g => {
            output.push(`
export namespace ${g.key}{
    ${g.values.map(v => v.schemaString).join('\n')}
}
`);
        });
        output.push(`
export namespace ${this.getNamespace(NAMESPACES.$types)}{
    ${this.polymorphicTypes.map(v => v.schemaString).join('\n')}
}
`);
        return prettier.format(output.join('\n\n'), { parser: 'typescript', singleQuote: true });
    }
}
exports.OpenApiToTs = OpenApiToTs;
var PROP_TYPES_MAP;
(function (PROP_TYPES_MAP) {
    PROP_TYPES_MAP["string"] = "string";
    PROP_TYPES_MAP["integer"] = "number";
    PROP_TYPES_MAP["number"] = "number";
    PROP_TYPES_MAP["boolean"] = "boolean";
    PROP_TYPES_MAP["object"] = "any";
    PROP_TYPES_MAP["binary"] = "Blob";
})(PROP_TYPES_MAP || (PROP_TYPES_MAP = {}));
var NAMESPACES;
(function (NAMESPACES) {
    NAMESPACES["$api"] = "api";
    NAMESPACES["$models"] = "models";
    NAMESPACES["$inputs"] = "inputs";
    NAMESPACES["$outputs"] = "outputs";
    NAMESPACES["$enums"] = "enums";
    NAMESPACES["$types"] = "types";
})(NAMESPACES || (NAMESPACES = {}));
var OPEN_API_TYPES;
(function (OPEN_API_TYPES) {
    OPEN_API_TYPES["object"] = "object";
    OPEN_API_TYPES["array"] = "array";
    OPEN_API_TYPES["enum"] = "enum";
})(OPEN_API_TYPES || (OPEN_API_TYPES = {}));
//# sourceMappingURL=open-api-to-ts.js.map