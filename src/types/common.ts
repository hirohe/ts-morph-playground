import { OptionalKind, ParameterDeclarationStructure } from 'ts-morph';
import { HttpMethod } from './OpenAPI3';

const HttpMethodsWithoutBody: HttpMethod[] = ['get', 'delete', 'options', 'head'];
const HttpMethodsWithBody: HttpMethod[] = ['post', 'put', 'patch'];

export interface RequestParameter extends OptionalKind<ParameterDeclarationStructure> {
  in?: string;
}

export interface RequestFunctionDefinition {
  name: string;
  path: string;
  parameters: RequestParameter[];
  method: typeof HttpMethodsWithBody[number] | typeof HttpMethodsWithoutBody[number];
  resultType?: string;
}

