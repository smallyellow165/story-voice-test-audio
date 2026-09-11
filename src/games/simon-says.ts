import { parseGame, type GameDefinition } from './game-runtime.ts'

export const SIMON_ACTIONS = [
  { id: 'clap', label: '拍拍手', description: '拍拍手！', icon: '👏' },
  { id: 'touch_head', label: '摸摸头', description: '摸摸你的头！', icon: '🙂' },
  { id: 'hands_up', label: '举起双手', description: '把两只手举高高！', icon: '🙌' },
  { id: 'stomp', label: '跺跺脚', description: '跺两下脚！', icon: '👣' },
  { id: 'jump', label: '跳一下', description: '像小兔子一样跳一下！', icon: '🐰' },
  { id: 'spin', label: '转一圈', description: '慢慢转一个圈！', icon: '🌀' },
] as const

// Only the action catalogue and three-action round selection belong to Simon.
// The existing runtime and panel still own evaluation, progression and lifecycle.
export function simonRoundFromIds(ids: readonly string[]): GameDefinition {
  if (ids.length !== 3 || new Set(ids).size !== 3) throw new Error('invalid_simon_round')
  const tasks = ids.map(id => {
    const action = SIMON_ACTIONS.find(action => action.id === id)
    if (!action) throw new Error('invalid_simon_action')
    return { id, description: action.description, condition: { type: 'manual' as const } }
  })
  return parseGame({ id: 'simon-says-lite-v1', name: 'Simon Says Lite · 动作指令', ringSlots: [], tasks })
}

export function createSimonRound(random = Math.random): GameDefinition {
  const remaining: string[] = SIMON_ACTIONS.map(action => action.id)
  const sequence: string[] = []
  for (let i = 0; i < 3; i++) sequence.push(remaining.splice(Math.floor(random() * remaining.length), 1)[0]!)
  return simonRoundFromIds(sequence)
}
