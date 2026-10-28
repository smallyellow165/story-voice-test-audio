export function imageHistoryGroups(records: readonly {sourceImageId: string}[]): {imageId:string;count:number}[]
export function historyForImage<T extends {sourceImageId:string}>(records:T[],imageId:string):T[]
