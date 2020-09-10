import yaml, { JSON_SCHEMA } from 'js-yaml';

export function yamlToJson(content: string): any {
  return yaml.safeLoad(content, { schema: JSON_SCHEMA, json: true });
}
