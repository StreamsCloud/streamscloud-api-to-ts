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
        this.sanitizeTypeName = (typeName) => typeName.replace(/DTO$/i, '').replace(/Request$/i, '').replace(/Response$/i, '');
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
    parse(spec) {
        const output = [`
/**
 * This file was auto-generated.
 * Do not make direct changes to the file.
**/
`];
        try {
            const schemas = spec.components.schemas;
            this.allTypes = !schemas ? [] : Object.entries(schemas).map(([typeName, typeDefinition]) => {
                const getNamespace = () => {
                    if (typeDefinition.type !== OPEN_API_TYPES.object)
                        return this.getNamespace(NAMESPACES.$enums);
                    if (typeName.endsWith('Request'))
                        return this.getNamespace(NAMESPACES.$requests);
                    if (typeName.endsWith('Response'))
                        return this.getNamespace(NAMESPACES.$responses);
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
    NAMESPACES["$models"] = "models";
    NAMESPACES["$requests"] = "requests";
    NAMESPACES["$responses"] = "responses";
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