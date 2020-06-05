// put this on your scripts folder
// invoke directly with node or add to package.json > scripts
import * as fetch from 'node-fetch';
import * as fs from 'fs';
import { OpenApiToTs } from './open-api-to-ts'

async function run() {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
  const [swaggerDocUrl, exportFilePath, namespacePrefix] = process.argv.slice(2);

  const isTestEnv = swaggerDocUrl === true.toString();

  const apiDef = await fetch(isTestEnv ? 'https://localhost:60443/swagger/v1/swagger.json' : swaggerDocUrl).then(r => r.json());

  const schemaParser = new OpenApiToTs(namespacePrefix);
  try {
    const typesString = schemaParser.parse(apiDef, isTestEnv);
    if (isTestEnv) {
      if (!fs.existsSync('output')) {
        fs.mkdirSync('output');
      }
      fs.writeFileSync('output/output.ts', typesString);
    } else {
      fs.writeFileSync(exportFilePath, typesString);
    }
  } catch (e) {
    console.error('open-api-to-ts error: ' + e.toString());
  }

  console.log('okay')
}

run();
