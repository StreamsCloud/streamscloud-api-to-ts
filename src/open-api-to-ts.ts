import * as prettier from 'prettier';
import { Utils } from './utils';

export class OpenApiToTs {
  private allTypes: IDeclaringTypeDefinition[];
  private endpoints: IEndpointDefinition[];
  private polymorphicTypes: IDeclaringTypeDefinition[] = [];
  private polymorphicTypesWithBase: IPolymorphicTypeWithBase[] = [];

  constructor(private namespacePrefix) {
  }

  public parse(spec, isTest: boolean): string {

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

      this.allTypes = !schemas ? [] : Object.entries(schemas).map(([typeName, typeDefinition]: [string, any]) => {
        const getNamespace = () => {
          if (typeDefinition.type !== OPEN_API_TYPES.object) return this.getNamespace(NAMESPACES.$enums);

          if (typeName.endsWith('Request')) return this.getNamespace(NAMESPACES.$requests);
          if (typeName.endsWith('Response')) return this.getNamespace(NAMESPACES.$responses);
          return this.getNamespace(NAMESPACES.$models);
        };
        const definition: IDeclaringTypeDefinition = {
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
        } else if (definition.type === OPEN_API_TYPES.object) {
          // parse object properties
          definition.properties = this.parseObjectProperties(typeDefinition, definition.required);
        } else {
          definition.type = 'unknown';
        }

        return definition;
      });
    } catch (e) {
      console.error('Types error' + e.toString())
    }
    this.allTypes.sort((a, b) => a.name.localeCompare(b.name));
    this.allTypes.forEach(this.generateDeclaringTypeSchemaString);

    try {
      const paths = spec.paths;

      this.endpoints = Object.entries(paths).map(([eTemplate, eDefinition]: [string, any]) => {
        const templateParts = eTemplate.slice(1).split('/').filter(p => !!p && !p.includes('{'));
        const controller = templateParts[0];
        if (!controller) return null;
        const [method, description] = Object.entries(eDefinition)[0];
        const nameParts = templateParts.slice(1);
        const name = nameParts.length ? nameParts.map(p => Utils.toUpperCamelCase(p)).join('') : method;
        const definition: IEndpointDefinition = {
          template: `${method.toUpperCase()} ${eTemplate}`,
          name: Utils.toCamelCase(name),
          controller,
          method,
          url: templateParts.map(p => Utils.toCamelCase(p)).join('/')
        };
        Object.assign(definition, description);
        return definition;
      }).filter(e => e);
    } catch (e) {
      console.error('Endpoints error: ' + e.toString())
    }

    this.endpoints.sort((a, b) => a.name.localeCompare(b.name));
    this.endpoints.forEach(this.generateEndpointStringRepresentation);


    output.push(`/* eslint-disable @typescript-eslint/no-namespace */
    export namespace ${this.getNamespace(NAMESPACES.$api)}{`);
    const endpointGroups = Utils.groupBy(this.endpoints, x => x.controller);
    endpointGroups.sort((a, b) => a.key.localeCompare(b.key));
    endpointGroups.forEach(g => {
      output.push(`
@autoinject()
export class ${g.key} {
  constructor(private dc: DataContext) {
  }
  ${g.values.map(v => v.stringRepresentation).join('\n\n')}
  }
`)
    });
    output.push('}');

    this.updatePolyTypesWithBase();
    const modelGroups = Utils.groupBy(this.allTypes, x => x.namespace);
    modelGroups.sort((a, b) => a.key.localeCompare(b.key));
    modelGroups.forEach(g => {
      output.push(`
export namespace ${g.key}{
    ${g.values.map(v => v.schemaString).join('\n')}
}
`)
    });

    output.push(`
export namespace ${this.getNamespace(NAMESPACES.$types)}{
    ${this.polymorphicTypes.map(v => v.schemaString).join('\n')}
}
`);
    return prettier.format(output.join('\n\n'), { parser: 'typescript', singleQuote: true });
  }

  private generateDeclaringTypeSchemaString = (typeDefinition: IDeclaringTypeDefinition) => {
    switch (typeDefinition.type) {
      case OPEN_API_TYPES.object:
        return this.generateInterfaceSchema(typeDefinition);
      case OPEN_API_TYPES.enum:
        return this.generateEnumSchemaString(typeDefinition);
      default: {
        typeDefinition.schemaString = `/*
                 * Error parsing object ${typeDefinition.originalName}: Unknown type
                 */`
      }
    }
  };

  private generateInterfaceSchema = (typeDefinition: IDeclaringTypeDefinition, generateAnonymousType = false) => {
    const extendsTypes = [];
    if (Array.isArray(typeDefinition.allOf)) {
      typeDefinition.allOf.forEach(def => {
        if (def.$ref) {
          extendsTypes.push(this.typeToString(def));
        }
      })
    }
    const extendsString = extendsTypes.length ? ` extends ${extendsTypes.join(', ')}` : '';
    const explicitInterfaceHeader = generateAnonymousType ? '' : `export interface ${typeDefinition.name} ${extendsString}`;
    const header = `${explicitInterfaceHeader}{`;
    let sb: string[];
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
          if (property.format) comments.push(property.format);
          if (property.nullable) comments.push('nullable');
        }

        const commentsString = comments.length ? `// ${comments.join(', ')}` : '';
        sb.push(`${readonlyPrefix}${propName}: ${propType}${defaultValue}; ${commentsString}`);
      });
    } catch (e) {
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

  private generateEnumSchemaString = (typeDefinition: IDeclaringTypeDefinition) => {
    const header = `export enum ${typeDefinition.name} {`;
    let sb: string[];
    try {
      sb = [header];
      sb.push(typeDefinition.enum.map(value => (`${value} = '${value}'`)).join(',\n'));
    } catch (e) {
      sb = [header];
      sb.push(`/*
                    *${e.toString()}
                    */`);
    }
    sb.push('}');
    typeDefinition.schemaString = sb.join('\n');
  };

  private generateEndpointStringRepresentation = (endpoint: IEndpointDefinition) => {
    const sb = [`// ${endpoint.template}`];
    const methodParamParts = [];
    let body: { paramName: string, schema: string, isFormData: boolean } = null;
    if (endpoint.requestBody && endpoint.requestBody.content) {
      const entries = Object.entries(endpoint.requestBody.content);
      const jsonModel = entries.find(([mimeType]) => mimeType === 'application/json');
      if (jsonModel) {
        body = {
          paramName: 'payload',
          isFormData: false,
          schema: this.typeToString(jsonModel[1]['schema'] as IOATypeDefinition)
        };
      }
      const formModel = entries.find(([mimeType]) => mimeType === 'multipart/form-data');
      if (formModel) {
        const properties = this.parseObjectProperties(formModel[1]['schema'] as { properties: any });

        const complexPropertyTypes = endpoint.parameters ?? [];
        endpoint.parameters = null;

        complexPropertyTypes.forEach(paramDef => {
          const newProp = paramDef.schema;
          newProp.propertyName = paramDef.name;
          properties.push(newProp);
        });
        const anonymousTypeDefinition: IDeclaringTypeDefinition = {
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

    const queryParams: IParameterDefinition[] = (endpoint.parameters ?? []).filter(p => p.in === 'query');
    if (queryParams.length) {
      queryParams.forEach(param => {
        const optionalMark = param.required ? '' : '?';
        methodParamParts.push(`${param.name}${optionalMark}: ${this.typeToString(param.schema)}`);
      })
    }
    const responseType = this.getResponseType(endpoint);
    sb.push(`public ${endpoint.name}(${methodParamParts.join(', ')}):Promise<${responseType ?? 'void'}>{`);
    const dcMethodParams = [`'${endpoint.url}'`];
    let payloadGeneration = '';
    if (['post', 'put'].includes(endpoint.method)) {
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
        } else {
          dcMethodParams.push(body.paramName);
        }
      } else {
        dcMethodParams.push('null');
      }

    }
    let paramsGeneration: string = null;
    if (queryParams.length) {
      const paramName = 'params';
      const paramsSb = [];
      const requiredParams = queryParams.filter(p => p.required);
      paramsSb.push(`const ${paramName} = {${requiredParams.map(p => p.name).join(', ')}};`);
      const optionalParams = queryParams.filter(p => !p.required);
      optionalParams.forEach(param => {
        paramsSb.push(`if(${param.name}!==undefined){
                    ${paramName}['${param.name}'] = ${param.name};
                }`)
      });
      paramsGeneration = paramsSb.join('\n');
      dcMethodParams.push(paramName);
    }
    if (payloadGeneration) {
      sb.push(payloadGeneration)
    }
    if (paramsGeneration) {
      sb.push(paramsGeneration)
    }
    sb.push(`return this.dc.${endpoint.method}(${dcMethodParams.join(', ')});`);
    sb.push('}');
    endpoint.stringRepresentation = sb.join('\n');
  };

  private getResponseType = (endpoint: IEndpointDefinition): string => {
    const types = [];
    const responses = Object.entries(endpoint.responses);
    responses.forEach(([code, body]) => {
      const statusCode = parseInt(code);
      if (statusCode < 200 || statusCode >= 300 || !body.content) return;

      const entries = Object.entries(body.content);
      const jsonModel = entries.find(([mimeType]) => mimeType === 'application/json');

      if (!jsonModel || !jsonModel[1]['schema']) return;
      types.push(this.typeToString(jsonModel[1]['schema'] as IOATypeDefinition));
    });

    if (!types.length) return 'void';
    return types.join(' | ');
  };

  private typeToString = (definition: IOATypeDefinition): string => {
    if (!definition) return '';
    const originalIsNullable = definition.nullable;
    definition.nullable = false;

    const getRefName = (lookup: string) => lookup.replace('#/components/schemas/', '');

    const getRef = (lookup: string): IDeclaringTypeDefinition => this.allTypes.find(t => t.originalName === getRefName(lookup));

    const getQualifiedName = (ref: IDeclaringTypeDefinition) => `${ref.namespace}.${ref.name}`;

    const getAllOfRef = () => Array.isArray(definition.allOf) && definition.allOf.length && definition.allOf[0].$ref;

    const isBinary = (def: IOATypeDefinition) => def.format === 'binary';

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

        let polyDefinition: IDeclaringTypeDefinition = this.polymorphicTypes.find(t => t.originalName == typeName);
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
            })
          }
        }

        return getQualifiedName(polyDefinition);
      }
      return getDerivedTypesString();
    }

    // DICTIONARY
    if (definition.type === OPEN_API_TYPES.object && definition.additionalProperties) {
      const recordType = (type: string) => `Record<string, ${type}>`;
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

  private parseObjectProperties = (input: { properties: any }, requiredList?: string[]): IOATypeDefinition[] => {
    if (!input.properties) return [];
    const defs = Object.entries(input.properties).map(([key, propDefinition]) => {
      const prop: IOATypeDefinition = { propertyName: key };
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

  private sanitizeTypeName = (typeName: string) => typeName.replace(/DTO$/i, '').replace(/Request$/i, '').replace(/Response$/i, '')

  private updatePolyTypesWithBase = () => {
    if (!this.polymorphicTypesWithBase) return;

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
    })
  }

  private getNamespace = (namespace: NAMESPACES) => {
    let parsedNamespace = namespace.toString();
    if(this.namespacePrefix){
      parsedNamespace = `${this.namespacePrefix}${Utils.toUpperCamelCase(namespace)}`;
    }
    return `$${parsedNamespace}`;
  }
}

interface IDeclaringTypeDefinition {
  originalName: string;
  name: string;
  namespace: string;

  schemaString?: string;

  enum?: string[];
  properties?: IOATypeDefinition[];
  allOf?: IOATypeDefinition[];
  required?: string[];
  type?: OPEN_API_TYPES.object | OPEN_API_TYPES.enum | 'unknown'
}

interface IOATypeDefinition {
  propertyName?: string;
  allOf?: IOATypeDefinition[];
  oneOf?: IOATypeDefinition[];
  $ref?: string;
  type?: string;
  format?: string;
  nullable?: boolean;
  readOnly?: boolean;
  description?: string;
  default?: string;
  items?: IOATypeDefinition;
  properties?: Record<string, { $ref: string }>
  additionalProperties?: boolean | IOATypeDefinition;
}

interface IEndpointDefinition {
  template: string;
  controller: string;
  name: string;
  method: string;
  url: string;

  parameters?: IParameterDefinition[];
  requestBody?: IComplexTypeDefinition;
  responses?: Record<string, IComplexTypeDefinition>;


  stringRepresentation?: string;
}

interface IComplexTypeDefinition {
  name: string;
  description: string;
  content: Record<string, Record<string, IOATypeDefinition | { properties: any }>>;
}

interface IParameterDefinition {
  name: string;
  in: string;
  required: boolean;
  schema: IOATypeDefinition;
}

interface IPolymorphicTypeWithBase {
  typeName: string;
  baseTypeName: string;
}

enum PROP_TYPES_MAP {
  string = 'string',
  integer = 'number',
  number = 'number',
  boolean = 'boolean',
  object = 'any',
  binary = 'Blob'
}

enum NAMESPACES {
  $api = 'api',
  $models = 'models',
  $requests = 'requests',
  $responses = 'responses',
  $enums = 'enums',
  $types = 'types'
}

enum OPEN_API_TYPES {
  object = 'object',
  array = 'array',
  enum = 'enum'
}
