"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Utils {
}
exports.Utils = Utils;
Utils.groupBy = (xs, keyProperty) => {
    return xs.reduce((rv, x) => {
        const key = keyProperty instanceof Function ? keyProperty(x) : x[keyProperty];
        const existent = rv.find((r) => r && r.key === key);
        if (existent) {
            existent.values.push(x);
        }
        else {
            rv.push({
                key: key,
                values: [x]
            });
        }
        return rv;
    }, []);
};
Utils.toUpperCamelCase = (value) => {
    return value[0].toUpperCase() + value.slice(1);
};
Utils.toCamelCase = (value) => {
    return value[0].toLowerCase() + value.slice(1);
};
//# sourceMappingURL=utils.js.map