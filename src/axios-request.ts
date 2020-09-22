import { CodeBlockWriter } from 'ts-morph';
import { HttpMethodsWithBody, RequestFunctionDefinition } from './types/common';

export function generateRequestFunctionBody(requestDefinition: RequestFunctionDefinition, writer: CodeBlockWriter): void {
  const {
    path,
    method,
    parameters,
    resultType,
  } = requestDefinition;

  let requestPath = '';
  if (/[{}]+/.test(path)) {
    requestPath = `\`${path.replace(/{/g, '${')}\``;
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

  let bodyParam = '';
  if (HttpMethodsWithBody.includes(method)) {
    // check from parameters
    const bodyParamName = parameters.find(p => p.in === 'body')?.name;
    if (bodyParamName) {
      bodyParam = bodyParamName;
    }
  }

  writer.write(`return request.${method}${requestReturnType}(${requestPath}${bodyParam ? `, ${bodyParam}` : ''}${config ? `, ${config}` : ''})`);

  if (resultType) writer.write('.then(res => res.data);');
}
