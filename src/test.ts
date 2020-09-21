import {
  FunctionDeclarationStructure, ImportSpecifierStructure,
  InterfaceDeclarationStructure, JSDocStructure,
  OptionalKind,
  Project,
  SourceFile,
  SourceFileCreateOptions,
  StructureKind,
  TypeElementMemberedNodeStructure,
} from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { kebabCase, camelCase } from 'case-anything';
import { yamlToJson } from './utils/yaml';
import {
  isOpenAPI3TextReference, isParameterObject, MediaTypeObject,
  OpenAPI3,
  OpenAPI3Reference,
  OpenAPI3SchemaObject, OpenAPI3TextReference,
  OpenAPI3Type, Operation,
  PathItem,
  HttpMethod, isBasicTypeSchemaObject,
} from './types/OpenAPI3';
import { ReservedKeywords } from './utils/keywords';
import { RequestFunctionDefinition, RequestParameter } from './types/common';
import { generateRequestFunctionBody } from './axios-request';

const HttpMethodsWithoutBody: HttpMethod[] = ['get', 'delete', 'options', 'head'];
const HttpMethodsWithBody: HttpMethod[] = ['post', 'put', 'patch'];

function escapeKeywords(s: string) {
  if (ReservedKeywords.some(k => k === s)) {
    // TODO
    return '_' + s;
  }
  return s;
}

const OpenAPI3TypeInterfaceTypeMap: { [key: string]: string } = {
  array: 'any[]',
  boolean: 'boolean',
  integer: 'number',
  number: 'number',
  object: 'any',
  string: 'string',
};

function openAPI3TypeToTypeName(type?: OpenAPI3Type) {
  return type ? OpenAPI3TypeInterfaceTypeMap[type] : 'any';
}

function normalizeSchemaName(name: string) {
  if (name) {
    return name.replace(/[._]/g, '');
  }
  return name;
}

function parseRefText(ref: string): string[] {
  if (ref) {
    return ref.replace('#', '').split('/');
  }
  return [];
}

function schemaObjectAsTypeName(schema: OpenAPI3SchemaObject | OpenAPI3TextReference): string | null {
  if (isOpenAPI3TextReference(schema)) {
    return normalizeSchemaName(parseRefText(schema.$ref).slice(-1)[0]);
  } else if (schema.type) {
    if (schema.type === 'array' && schema.items) {
      return `${schemaObjectAsTypeName(schema.items)}[]`;
    } else {
      return openAPI3TypeToTypeName(schema.type);
    }
  }
  return null;
}

function addTypeImportToFile(typeImport: OptionalKind<ImportSpecifierStructure>, sourceFile: SourceFile, typeFile: SourceFile) {
  // try to prevent duplicate import
  const theImportDeclaration = sourceFile.getImportDeclaration(importDeclaration => {
    return importDeclaration.getModuleSpecifierSourceFile()?.getFilePath() === typeFile.getFilePath();
  });
  if (theImportDeclaration) {
    if (theImportDeclaration.getNamedImports().every(named => named.getName() !== typeImport.name)) {
      theImportDeclaration.addNamedImport(typeImport);
    }
  } else {
    sourceFile.addImportDeclaration({ namedImports: [typeImport], moduleSpecifier: '' }).setModuleSpecifier(typeFile);
  }
}

async function main() {
  const project = new Project({
  });

  const srcDir = path.join(__dirname, '..');
  const templateDir = path.join(srcDir, 'template');
  const buildDir = path.join(srcDir, 'build');
  const openapi3TestDir = path.join(srcDir, 'test', 'openapi3');

  const sourceFileBaseOptions: SourceFileCreateOptions = { overwrite: true };

  project.addSourceFileAtPath(path.join(templateDir, 'request.ts'));
  const servicesDir = project.createDirectory(path.join(buildDir, 'services'));
  const typesDir = project.createDirectory(path.join(buildDir, 'types'));

  fs.mkdirSync(path.join(buildDir, 'services'), { recursive: true });
  fs.copyFileSync(path.join(templateDir, 'request.ts'), path.join(buildDir, 'services', 'request.ts'));
  const requestFile = servicesDir.addSourceFileAtPath('request.ts');

  const typeFile = typesDir.createSourceFile('common.ts', {
    kind: StructureKind.SourceFile,
  }, sourceFileBaseOptions);
  const exampleInterface: OptionalKind<InterfaceDeclarationStructure> = {
    name: 'Example',
    isExported: true,
    properties: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
    ],
  };

  function processPathItem(pathString: string, pathItem: PathItem, method: keyof Omit<PathItem, 'description'>, serviceFileByTag: { [tag: string]: SourceFile }, commonServiceFile: SourceFile) {
    const operation = pathItem[method] as Operation;
    if (operation === undefined) return;

    let serviceFile: SourceFile;
    if (operation.tags.length > 0) {
      const tag = operation.tags[0];
      if (serviceFileByTag[tag]) {
        serviceFile = serviceFileByTag[tag];
      } else {
        serviceFile = servicesDir.createSourceFile(`${kebabCase(tag.toLowerCase())}.ts`, { kind: StructureKind.SourceFile }, sourceFileBaseOptions);
        // basic import
        serviceFile.addImportDeclaration({ defaultImport: 'request', moduleSpecifier: '' }).setModuleSpecifier(requestFile);
        serviceFileByTag[tag] = serviceFile;
      }
    } else {
      console.log('no tags, will use common service file');
      serviceFile = commonServiceFile;
    }

    let returnType: string | undefined;
    if (operation.responses['200']) {
      const successResponse = operation.responses['200'];
      if (isOpenAPI3TextReference(successResponse)) {
        // TODO how is this looks like ?
        console.log('------ SPECIAL CASE ------');
        console.log('successResponse', successResponse);
      } else {
        if (successResponse.content) {
          for (const contentType in successResponse.content) {
            // TODO if contentType kind of json structure
            if (/application\/.*json/.test(contentType)) {
              const contentMediaType = successResponse.content[contentType] as MediaTypeObject;
              if (isOpenAPI3TextReference(contentMediaType.schema)) {
                const refPaths = parseRefText(contentMediaType.schema.$ref);
                if (refPaths.length > 0) {
                  returnType = normalizeSchemaName(refPaths[refPaths.length - 1]);
                  const typeImport: OptionalKind<ImportSpecifierStructure> = { name: returnType };
                  addTypeImportToFile(typeImport, serviceFile, typeFile);
                }
              } else {
                if (contentMediaType.schema.type === 'array' && isOpenAPI3TextReference(contentMediaType.schema.items)) {
                  const refPaths = parseRefText(contentMediaType.schema.items.$ref);
                  if (refPaths.length > 0) {
                    const theReturnType = normalizeSchemaName(refPaths[refPaths.length - 1]);
                    const typeImport: OptionalKind<ImportSpecifierStructure> = { name: theReturnType };
                    returnType = theReturnType + '[]';
                    addTypeImportToFile(typeImport, serviceFile, typeFile);
                  }
                } else if (isBasicTypeSchemaObject(contentMediaType.schema)) {
                  returnType = contentMediaType.schema.type;
                } else {
                  // TODO
                  console.log('------ SPECIAL CASE ------');
                  console.log('contentMediaType.schema', contentMediaType.schema);
                }
              }
            }
          }
        }
      }
    }

    const parameters: RequestParameter[] = [];
    if (operation.parameters && operation.parameters.length > 0) {
      operation.parameters.forEach(parameter => {
        if (isParameterObject(parameter)) {
          parameters.push({
            in: parameter.in,
            name: parameter.name,
            type: schemaObjectAsTypeName(parameter.schema) || 'any',
            hasQuestionToken: !parameter.required,
          });
        }
      });
    }

    // request body
    function textReferenceToRequestBodyParameter(ref: string) {
      const requestBodyTypeName = parseRefText(ref).slice(-1)[0];
      return {
        in: 'body',
        name: camelCase(requestBodyTypeName),
        type: requestBodyTypeName,
        hasQuestionToken: false,
      } as RequestParameter;
    }
    if (operation.requestBody) {
      if (isOpenAPI3TextReference(operation.requestBody)) {
        // add to parameters
        parameters.push(textReferenceToRequestBodyParameter(operation.requestBody.$ref));
      } else {
        Object.entries(operation.requestBody.content).forEach(([contentType, content]) => {
          if (isJSONContentType(contentType)) {
            if (isOpenAPI3TextReference(content.schema)) {
              parameters.push(textReferenceToRequestBodyParameter(content.schema.$ref));
            }
          }
        })
      }
    }

    parameters.sort((a, b) => {
      return (b.hasQuestionToken ? -1 : 0) - (a.hasQuestionToken ? -1 : 0);
    });

    const docs: OptionalKind<JSDocStructure>[] = [];
    if (operation.summary) {
      docs.push({ description: operation.summary });
    }

    const operationFunctionStructure: OptionalKind<FunctionDeclarationStructure> = {
      // TODO operationId is not for function name
      // TODO operationId should escape from js keyword export,function,delete,class,new...
      name: escapeKeywords(operation.operationId),
      isExported: true,
      returnType: returnType ? `Promise<${returnType}>` : undefined,
      parameters,
      docs,
    };

    try {
      const requestDefinition: RequestFunctionDefinition = {
        name: escapeKeywords(operation.operationId),
        method,
        path: pathString,
        parameters,
        resultType: returnType,
      };

      serviceFile.addFunction(operationFunctionStructure).setBodyText(writer => {
        generateRequestFunctionBody(requestDefinition, writer);
      });
    } catch (e) {
      console.log('error in addFunction', e);
    }
    serviceFile.saveSync();
  }

  await fs.promises.readFile(path.join(openapi3TestDir, 'petstore.yaml').toString(), 'utf8').then(content => {
    const openapi3 = yamlToJson(content) as OpenAPI3;

    // components
    if (openapi3.components) {
      Object.keys(openapi3.components.schemas).forEach(originSchemaName => {
        const schemaName = normalizeSchemaName(originSchemaName);
        if (Object.prototype.hasOwnProperty.call(openapi3.components.schemas, originSchemaName)) {
          const schema = openapi3.components.schemas[originSchemaName] as OpenAPI3SchemaObject;
          console.log('parsing schema', schemaName);
          const interfaceDeclaration = convertSchemaToInterfaceDeclaration(schemaName, schema);
          interfaceDeclaration.isExported = true;
          typeFile.addInterface(interfaceDeclaration);
        }
      });
    }

    // paths
    const serviceFileByTag: { [tag: string]: SourceFile } = {};
    const commonServiceFile = servicesDir.createSourceFile('common.ts', { kind: StructureKind.SourceFile }, sourceFileBaseOptions);
    if (openapi3.paths) {
      // how to group services
      for (const path in openapi3.paths) {
        if (Object.prototype.hasOwnProperty.call(openapi3.paths, path) && path.startsWith('/')) {
          const pathItem = openapi3.paths[path] as PathItem;

          [...HttpMethodsWithoutBody, ...HttpMethodsWithBody].forEach(method => {
            if (pathItem[method]) {
              console.log(`path: ${method} ${path}`);
              processPathItem(path, pathItem, method, serviceFileByTag, commonServiceFile);
            }
          });
        }
      }
    }
  });

  function convertSchemaToInterfaceDeclaration(name: string, schema: OpenAPI3SchemaObject): InterfaceDeclarationStructure {
    const interfaceProperties: TypeElementMemberedNodeStructure['properties'] = [];

    if (schema.properties) {
      Object.keys(schema.properties).forEach(propertyName => {
        if (schema.properties) {
          const property = schema.properties[propertyName] as OpenAPI3SchemaObject | OpenAPI3Reference;
          if ((property as OpenAPI3SchemaObject).type) {
            const schemaProperty = property as OpenAPI3SchemaObject;
            if (schemaProperty.type === 'array' && schemaProperty.items) {
              if ((schemaProperty.items as any).$ref) {
                const typeName = parseRefText((schemaProperty.items as any).$ref).slice(-1)[0];
                interfaceProperties.push({
                  name: propertyName,
                  type: normalizeSchemaName(typeName) + '[]',
                  docs: schemaProperty.description ? [{ description: schemaProperty.description }] : undefined,
                });
              }
            } else {
              interfaceProperties.push({
                name: propertyName,
                type: openAPI3TypeToTypeName(schemaProperty.type),
                docs: schemaProperty.description ? [{ description: schemaProperty.description }] : undefined,
              });
            }
          } else {
            if ((property as any).$ref) {
              const schemaRefProperty = property as { $ref: string };
              const typeName = parseRefText(schemaRefProperty.$ref).slice(-1)[0];
              interfaceProperties.push({
                name: propertyName,
                type: normalizeSchemaName(typeName),
              });
            }
          }
        }
      });
    }

    const theInterface = {
      name,
      properties: interfaceProperties,
    } as InterfaceDeclarationStructure;

    if (schema.description) {
      theInterface.docs = [{ description: schema.description }];
    }

    return theInterface;
  }

  typeFile.addInterface(exampleInterface);

  const exampleServiceFile = servicesDir.createSourceFile('example.ts', '', sourceFileBaseOptions);

  exampleServiceFile.addImportDeclaration({ defaultImport: 'request', moduleSpecifier: './request' });
  exampleServiceFile.addImportDeclaration({ namedImports: [{ name: exampleInterface.name }], moduleSpecifier: `../types/${typeFile.getBaseNameWithoutExtension()}` });
  const fetchExampleFunction = exampleServiceFile.addFunction({
    name: 'fetchExample',
    returnType: `Promise<${exampleInterface.name}>`,
    isExported: true,
  });

  fetchExampleFunction.setBodyText(writer =>
    writer.write(`return request.get<${exampleInterface.name}>('/example').then(res => res.data);`),
  );

  project.saveSync();
}

main();
