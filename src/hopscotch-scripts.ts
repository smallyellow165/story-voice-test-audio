import type { HopscotchScript } from './hopscotch-core'

// Hand-authored rounds: one level per move under the default configuration.
// Outbound six tasks, then six homeward tasks; duration is child-paced.
export const HOPSCOTCH_SCRIPTS: readonly HopscotchScript[] = [
  {
    id: 'basic', title: '基础跳跃', tasks: [
      { id: 'basic-01', type: 'jump_to', target: '2' },
      { id: 'basic-02', type: 'jump_to', target: '4' },
      { id: 'basic-03', type: 'jump_to', target: '5' },
      { id: 'basic-04', type: 'jump_to', target: '7' },
      { id: 'basic-05', type: 'jump_to', target: '8' },
      { id: 'basic-06', type: 'jump_to', target: '10' },
      { id: 'basic-07', type: 'jump_to', target: '9' },
      { id: 'basic-08', type: 'jump_to', target: '7' },
      { id: 'basic-09', type: 'jump_to', target: '6' },
      { id: 'basic-10', type: 'jump_to', target: '4' },
      { id: 'basic-11', type: 'jump_to', target: '3' },
      { id: 'basic-12', type: 'jump_to', target: '1' },
    ],
  },
  {
    id: 'mixed', title: '动作混合', tasks: [
      { id: 'mixed-01', type: 'jump_to', target: '3' },
      { id: 'mixed-02', type: 'jump_to_and_clap', target: '4' },
      { id: 'mixed-03', type: 'jump_to', target: '6' },
      { id: 'mixed-04', type: 'jump_to_and_turn', target: '7' },
      { id: 'mixed-05', type: 'jump_to', target: '9' },
      { id: 'mixed-06', type: 'jump_to_and_clap', target: '10' },
      { id: 'mixed-07', type: 'jump_to', target: '8' },
      { id: 'mixed-08', type: 'jump_to_and_turn', target: '7' },
      { id: 'mixed-09', type: 'jump_to', target: '5' },
      { id: 'mixed-10', type: 'jump_to_and_clap', target: '4' },
      { id: 'mixed-11', type: 'jump_to', target: '2' },
      { id: 'mixed-12', type: 'jump_to_and_clap', target: '1' },
    ],
  },
]
