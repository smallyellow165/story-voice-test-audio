import catalogData from './standard-profile-catalog.v1.json' with { type: 'json' };
import type { Profile } from './geometry.ts';
import { canonicalProfileSnapshot } from './three-d/canonical-geometry';
import type { ProfileSnapshot3D } from './three-d/profile-adapter.ts';

export interface StandardProfileCatalogV1 {
  catalogId: 'magnetic-standard-profile-catalog';
  schemaVersion: 1;
  registryRevision: number;
  registryHash: string;
  standardThickness: number;
  unitEdgeDescription: string;
  activeStandardProfileKeys: string[];
  profiles: Profile[];
}

export const standardProfileCatalog = catalogData as unknown as StandardProfileCatalogV1;

export const standardCatalogProfiles: Profile[] = standardProfileCatalog.profiles;

const profileByKey = new Map<string, Profile>();
const snapshotByKey = new Map<string, ProfileSnapshot3D>();

for (const profile of standardCatalogProfiles) {
  const key = `${profile.id}@${profile.version}`;
  profileByKey.set(key, profile);
  snapshotByKey.set(key, canonicalProfileSnapshot(profile));
}

export const activeStandardProfiles: Profile[] =
  standardProfileCatalog.activeStandardProfileKeys
    .map((key) => profileByKey.get(key))
    .filter((profile): profile is Profile => Boolean(profile));

export function getStandardProfileDefinition(
  id: string,
  version?: number,
): Profile | undefined {
  if (typeof version === 'number') {
    return profileByKey.get(`${id}@${version}`);
  }
  const activeKey = standardProfileCatalog.activeStandardProfileKeys.find((key) =>
    key.startsWith(`${id}@`),
  );
  if (activeKey) {
    return profileByKey.get(activeKey);
  }
  const candidates = standardCatalogProfiles.filter((profile) => profile.id === id);
  return candidates.sort((a, b) => b.version - a.version)[0];
}

export function getStandardProfileSnapshot(
  id: string,
  version?: number,
): ProfileSnapshot3D | undefined {
  const def = getStandardProfileDefinition(id, version);
  if (!def) return undefined;
  return snapshotByKey.get(`${def.id}@${def.version}`);
}
