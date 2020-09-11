import { promises as fs } from 'fs';
import path from 'path';
import prettier, { BuiltInParserName, RequiredOptions } from 'prettier';

async function walk(dir: string) {
  let files: any[] = await fs.readdir(dir);
  files = await Promise.all(files.map(async (file: any) => {
    const filePath = path.join(dir, file);
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) return walk(filePath);
    // stats.isFile()
    else return filePath;
  }));

  return files.reduce((all: any[], folderContents: any) => all.concat(folderContents), []);
}

const defaultOptions: Partial<RequiredOptions> = {
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  useTabs: false,
  trailingComma: 'es5',
};

export default function prettierFormat(dir: string) {
  walk(dir).then(files =>
    files.forEach(file =>
      fs.readFile(file, 'utf8').then(content => {
        const formattedContent = prettier.format(content, { ...defaultOptions, parser: 'typescript' });
        fs.writeFile(formattedContent, file).then(() => {
          console.log('file', file, 'formatted');
        });
      }),

      // prettier.getFileInfo(file, {}).then(fileInfo => {
      //   console.log('formatting', file)
      //   if (!fileInfo.ignored && fileInfo.inferredParser !== null) {
      //
      //   }
      // })
    ),
  );
}
