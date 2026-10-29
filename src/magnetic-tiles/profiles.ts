import data from './profiles.json' with { type: 'json' }
import { profileIssues } from './geometry.ts'
import type { Profile } from './geometry.ts'
export const profiles = data.profiles as Profile[]
if (data.schemaVersion !== 1 || profiles.some(p => profileIssues(p).length)) throw Error('磁力片 Profile 数据无效')
