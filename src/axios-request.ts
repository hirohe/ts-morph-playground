import { CodeBlockWriter } from 'ts-morph';
import { RequestFunctionDefinition } from './types/common';

export function generateRequestFunctionBody(requestDefinition: RequestFunctionDefinition, writer: CodeBlockWriter): void {
  const {
    path,
    method,
    parameters,
    resultType,
  } = requestDefinition;

  let requestPath = '';
  if (/[{}]+/.test(path)) {
    requestPath = `\`${path.replace('{', '${')}\``;
  } else {
    requestPath = `'${path}'`;
  }

  const requestReturnType = resultType ? `<${resultType}>` : '';

  let hasQueryParams = false;
  if (parameters.length > 0) {
    const queryParams = parameters.filter(p => p.in === 'query').map(p => p.name);
    if (queryParams.length > 0) {
      hasQueryParams = true;
      writer.writeLine(`const params = { ${queryParams.join(', ').replace(/,\s$/, '')} };`);
    }
  }

  // TODO body

  // config
  let config = '';
  if (hasQueryParams) {
    config = '{ params }';
  }

  writer.write(`return request.${method}${requestReturnType}(${requestPath}${config ? `, ${config}`: ''})`);
  writer.write('.then(res => res.data);');
}