// Shared domain data. Authority selects the state owner; permissions allow actions.
export type GamePermissions = {
  canControlGame: boolean;
  canAnswerGame: boolean;
  canUseMicrophone: boolean;
  canProvideCamera: boolean;
  canAdminGame: boolean;
}
export const NO_GAME_PERMISSIONS: Readonly<GamePermissions> = Object.freeze({
  canControlGame: false, canAnswerGame: false, canUseMicrophone: false,
  canProvideCamera: false, canAdminGame: false,
})
// Compatibility constructor for standalone modules; room policy never derives
// permissions from owner. New participant bindings resolve their explicit role.
export function defaultGamePermissions(owner = false, readOnly = false): GamePermissions {
  return permissionsForRole(readOnly ? 'viewer' : owner ? 'player' : 'parent')
}
export function readGamePermissions(value: unknown): GamePermissions {
  const record = value as Partial<GamePermissions> | undefined
  return Object.fromEntries(Object.keys(NO_GAME_PERMISSIONS).map(key => [key, record?.[key as keyof GamePermissions] === true])) as GamePermissions
}
export const GAME_ACTION_PERMISSIONS = {
  submit_answer: 'canAnswerGame', confirm_task: 'canControlGame', repeat_task: 'canControlGame',
  skip_task: 'canControlGame', reset: 'canControlGame', next_task: 'canControlGame', exit: 'canAdminGame',
} as const satisfies Record<string, keyof GamePermissions>
export type GameAction = keyof typeof GAME_ACTION_PERMISSIONS
export function allowsGameAction(permissions: GamePermissions, action: string): boolean {
  const key = GAME_ACTION_PERMISSIONS[action as GameAction]
  return !!key && permissions[key] === true
}

// Presets only. Gameplay authorization continues to use resolved permissions.
export type GameRole = 'player' | 'parent' | 'viewer'
export const GAME_ROLE_PERMISSIONS: Readonly<Record<GameRole, Readonly<GamePermissions>>> = Object.freeze({
  player: Object.freeze({ canControlGame: true, canAnswerGame: true, canUseMicrophone: true, canProvideCamera: true, canAdminGame: true }),
  parent: Object.freeze({ canControlGame: true, canAnswerGame: true, canUseMicrophone: true, canProvideCamera: false, canAdminGame: true }),
  viewer: NO_GAME_PERMISSIONS,
})
export const GAME_ROLES = Object.freeze(Object.keys(GAME_ROLE_PERMISSIONS) as GameRole[])
export function permissionsForRole(role: GameRole): GamePermissions {
  return { ...GAME_ROLE_PERMISSIONS[role] }
}
