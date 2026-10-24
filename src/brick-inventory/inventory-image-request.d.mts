import type { Media } from '../catalog-photo'
type Reader = (partNum: string, colorId?: number | null) => Promise<Media>
export function createInventoryImageReader(readJson?: (url: string, init: RequestInit, stage: string) => Promise<any>): Reader
export const readInventoryImage: Reader
