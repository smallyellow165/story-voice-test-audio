import gameJson from './games/touch-color.json'
import { parseGame } from './games/game-runtime'
import { mountScreenGame, type ScreenGameOptions } from './screen-game-module'
import css from './touch-color.css?inline'

export function mount(host: HTMLElement, options: ScreenGameOptions) {
  return mountScreenGame(host, options, { definition: parseGame(gameJson), touch: true }, css)
}
