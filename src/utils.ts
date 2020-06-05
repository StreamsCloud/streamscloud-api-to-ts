export class Utils {
    public static groupBy = <TItem>(xs: TItem[], keyProperty: string | ((x: TItem) => string)): IGroup<TItem>[] => {
        return xs.reduce((rv: IGroup<TItem>[], x: TItem) => {
            const key = keyProperty instanceof Function ? keyProperty(x) : x[keyProperty];
            const existent = rv.find((r) => r && r.key === key);
            if (existent) {
                existent.values.push(x);
            } else {
                rv.push({
                    key: key,
                    values: [x]
                });
            }
            return rv;
        }, []);
    };
    
    public static toUpperCamelCase = (value: string): string => {
        return value[0].toUpperCase() + value.slice(1);
    };
    
    public static toCamelCase = (value: string): string => {
        return value[0].toLowerCase() + value.slice(1);
    }
}

export interface IGroup<TItem> {
    key: string;
    values: TItem[]
}
