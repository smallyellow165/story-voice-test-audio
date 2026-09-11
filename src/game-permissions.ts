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
export function defaultGamePermissions(owner = false, readOnly = false): GamePermissions {
  return readOnly ? { ...NO_GAME_PERMISSIONS } : {
    canControlGame: true, canAnswerGame: true, canUseMicrophone: true,
    canProvideCamera: owner, canAdminGame: owner,
  }
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
