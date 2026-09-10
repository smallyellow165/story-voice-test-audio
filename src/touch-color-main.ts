import { mount } from './touch-color-module'
mount(document.querySelector<HTMLElement>('#touch-color')!, {
  instanceId: crypto.randomUUID(), onMessage: () => {},
})
