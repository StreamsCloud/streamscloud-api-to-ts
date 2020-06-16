"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
// put this on your scripts folder
// invoke directly with node or add to package.json > scripts
const fetch = require("node-fetch");
const fs = require("fs");
const open_api_to_ts_1 = require("./open-api-to-ts");
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
        const [swaggerDocUrl, exportFilePath, namespacePrefix] = process.argv.slice(2);
        const isTestEnv = swaggerDocUrl === true.toString();
        const apiDef = yield fetch(isTestEnv ? 'https://localhost:60443/swagger/v1/swagger.json' : swaggerDocUrl).then(r => r.json());
        const schemaParser = new open_api_to_ts_1.OpenApiToTs(namespacePrefix);
        try {
            const typesString = schemaParser.parse(apiDef, isTestEnv);
            if (isTestEnv) {
                if (!fs.existsSync('output')) {
                    fs.mkdirSync('output');
                }
                fs.writeFileSync('output/output.ts', typesString);
            }
            else {
                fs.writeFileSync(exportFilePath, typesString);
            }
        }
        catch (e) {
            console.error('open-api-to-ts error: ' + e.toString());
        }
        console.log('okay');
    });
}
run();
//# sourceMappingURL=index.js.map