import type {CatalogSearchFields} from './catalog-features.mjs'
export type PrintHint={term:string;label:string;sourcePath:string;evidence:string;status:'ungraded-text';policy:'retrieval-only'}
export function observationPrintHints(observation:unknown):PrintHint[]
export function applyPrintHint(fields:CatalogSearchFields,hint?:PrintHint):CatalogSearchFields
