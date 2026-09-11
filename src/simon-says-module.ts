import { mountScreenGame, type ScreenGameOptions } from './screen-game-module'
import baseCss from './touch-color.css?inline'
import css from './simon-says.css?inline'

export function mount(host: HTMLElement, options: ScreenGameOptions) {
  return mountScreenGame(host, options, { simon: true }, baseCss + css)
}
