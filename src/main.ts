import './style.css'

type AudioSample = {
  id: string
  speaker: string
  duration: number
  category: string
  text: string
  tags: string[]
  audio: string
}

type DurationFilter = 'all' | 'under-20' | '20-plus'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="${import.meta.env.BASE_URL}" aria-label="Story Voice home">
      <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></span>
      <span>Story Voice</span>
    </a>
    <span class="eyebrow">Audio test library</span>
  </header>

  <main>
    <section class="hero" aria-labelledby="page-title">
      <p class="kicker">Voice direction, made audible.</p>
      <h1 id="page-title">Find the right voice<br />for every story.</h1>
      <p class="intro">Search, filter, and audition speaker samples from one focused library.</p>
    </section>

    <section class="library" aria-labelledby="library-title">
      <div class="library-heading">
        <div><p class="section-label">Library</p><h2 id="library-title">Audio samples</h2></div>
        <p id="result-count" class="result-count" aria-live="polite">Loading samples…</p>
      </div>

      <div class="filters" aria-label="Audio sample filters">
        <label class="search-field">
          <span class="sr-only">Search text, speaker, or tag</span>
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
          <input id="search" type="search" placeholder="Search text, speaker, or tag" autocomplete="off" />
        </label>
        <label><span>Speaker</span><select id="speaker-filter"><option value="all">All speakers</option></select></label>
        <label><span>Duration</span><select id="duration-filter">
          <option value="all">Any duration</option>
          <option value="under-20">Under 20 sec</option>
          <option value="20-plus">20 sec or longer</option>
        </select></label>
        <label><span>Category</span><select id="category-filter"><option value="all">All categories</option></select></label>
      </div>

      <div id="sample-list" class="sample-list" aria-live="polite"></div>
    </section>

    <section class="test-tts" aria-labelledby="test-tts-title">
      <div class="test-tts-heading">
        <p class="section-label">Generator</p>
        <h2 id="test-tts-title">Gemini TTS test</h2>
        <p>Generate a local test file. Google credentials stay on the Node server.</p>
      </div>
      <form id="test-tts-form" class="test-tts-form">
        <label class="test-tts-text"><span>Text</span><textarea id="test-tts-text" required rows="4">瑞瑞，你怎么又把玉米藏到被子里面啦？</textarea></label>
        <label><span>Voice</span><input id="test-tts-voice" value="Achernar" autocomplete="off" /></label>
        <label class="test-tts-style"><span>Style instructions</span><textarea id="test-tts-style" rows="3">像妈妈和三岁小朋友说话，温柔自然，稍微夸张一点。</textarea></label>
        <div class="test-tts-actions">
          <button id="test-tts-submit" type="submit">Generate audio</button>
          <p id="test-tts-status" role="status" aria-live="polite"></p>
        </div>
      </form>
      <div id="test-tts-result" class="test-tts-result" hidden>
        <audio id="test-tts-player" controls preload="metadata"></audio>
        <p id="test-tts-meta"></p>
      </div>
    </section>
  </main>

  <footer><span>Story Voice</span><span>Local audio reference library</span></footer>
`

const searchInput = document.querySelector<HTMLInputElement>('#search')!
const speakerSelect = document.querySelector<HTMLSelectElement>('#speaker-filter')!
const durationSelect = document.querySelector<HTMLSelectElement>('#duration-filter')!
const categorySelect = document.querySelector<HTMLSelectElement>('#category-filter')!
const sampleList = document.querySelector<HTMLDivElement>('#sample-list')!
const resultCount = document.querySelector<HTMLParagraphElement>('#result-count')!
const testTtsForm = document.querySelector<HTMLFormElement>('#test-tts-form')!
const testTtsText = document.querySelector<HTMLTextAreaElement>('#test-tts-text')!
const testTtsVoice = document.querySelector<HTMLInputElement>('#test-tts-voice')!
const testTtsStyle = document.querySelector<HTMLTextAreaElement>('#test-tts-style')!
const testTtsSubmit = document.querySelector<HTMLButtonElement>('#test-tts-submit')!
const testTtsStatus = document.querySelector<HTMLParagraphElement>('#test-tts-status')!
const testTtsResult = document.querySelector<HTMLDivElement>('#test-tts-result')!
const testTtsPlayer = document.querySelector<HTMLAudioElement>('#test-tts-player')!
const testTtsMeta = document.querySelector<HTMLParagraphElement>('#test-tts-meta')!

let samples: AudioSample[] = []
let activeAudio: HTMLAudioElement | null = null
let activeButton: HTMLButtonElement | null = null

const escapeHtml = (value: string) => {
  const element = document.createElement('span')
  element.textContent = value
  return element.innerHTML
}

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

const setButtonState = (button: HTMLButtonElement, playing: boolean) => {
  button.classList.toggle('is-playing', playing)
  button.setAttribute('aria-label', playing ? 'Pause audio sample' : 'Play audio sample')
  button.querySelector('.play-label')!.textContent = playing ? 'Pause' : 'Play'
  button.querySelector('.play-icon')!.textContent = playing ? 'Ⅱ' : '▶'
}

const stopActiveAudio = () => {
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.currentTime = 0
  }
  if (activeButton) setButtonState(activeButton, false)
  activeAudio = null
  activeButton = null
}

const renderSamples = () => {
  stopActiveAudio()
  const query = searchInput.value.trim().toLocaleLowerCase()
  const speaker = speakerSelect.value
  const duration = durationSelect.value as DurationFilter
  const category = categorySelect.value

  const filtered = samples.filter((sample) => {
    const searchable = [sample.text, sample.speaker, sample.category, ...sample.tags].join(' ').toLocaleLowerCase()
    const matchesDuration = duration === 'all' ||
      (duration === 'under-20' && sample.duration < 20) ||
      (duration === '20-plus' && sample.duration >= 20)
    return (!query || searchable.includes(query)) &&
      (speaker === 'all' || sample.speaker === speaker) && matchesDuration &&
      (category === 'all' || sample.category === category)
  })

  resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'sample' : 'samples'}`

  if (filtered.length === 0) {
    sampleList.innerHTML = `<div class="empty-state"><p>No samples found.</p><button id="clear-filters" type="button">Clear filters</button></div>`
    document.querySelector<HTMLButtonElement>('#clear-filters')!.addEventListener('click', () => {
      searchInput.value = ''
      speakerSelect.value = 'all'
      durationSelect.value = 'all'
      categorySelect.value = 'all'
      renderSamples()
    })
    return
  }

  sampleList.innerHTML = filtered.map((sample, index) => `
    <article class="sample-card">
      <button class="play-button" type="button" data-audio-id="${escapeHtml(sample.id)}" aria-label="Play audio sample">
        <span class="play-icon" aria-hidden="true">▶</span><span class="play-label">Play</span>
      </button>
      <div class="sample-content">
        <div class="sample-meta"><span class="speaker">${escapeHtml(sample.speaker)}</span><span>${formatDuration(sample.duration)}</span><span>${escapeHtml(sample.category)}</span></div>
        <p class="sample-text">${escapeHtml(sample.text)}</p>
        <div class="tags">${sample.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      </div>
      <span class="sample-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
    </article>
  `).join('')

  sampleList.querySelectorAll<HTMLButtonElement>('.play-button').forEach((button) => {
    button.addEventListener('click', async () => {
      const sample = samples.find((item) => item.id === button.dataset.audioId)
      if (!sample) return

      if (button === activeButton && activeAudio) {
        if (activeAudio.paused) {
          await activeAudio.play()
          setButtonState(button, true)
        } else {
          activeAudio.pause()
          setButtonState(button, false)
        }
        return
      }

      stopActiveAudio()
      activeAudio = new Audio(new URL(sample.audio, window.location.origin + import.meta.env.BASE_URL).href)
      activeButton = button
      activeAudio.addEventListener('ended', stopActiveAudio, { once: true })
      try {
        await activeAudio.play()
        setButtonState(button, true)
      } catch {
        stopActiveAudio()
        button.querySelector('.play-label')!.textContent = 'Unavailable'
      }
    })
  })
}

const populateSelect = (select: HTMLSelectElement, values: string[]) => {
  values.forEach((value) => select.add(new Option(value, value)))
}

const loadSamples = async () => {
  try {
    const response = await fetch(new URL('data/audio-samples.json', window.location.origin + import.meta.env.BASE_URL))
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)
    samples = (await response.json()) as AudioSample[]
    populateSelect(speakerSelect, [...new Set(samples.map((sample) => sample.speaker))].sort())
    populateSelect(categorySelect, [...new Set(samples.map((sample) => sample.category))].sort())
    renderSamples()
  } catch (error) {
    console.error(error)
    resultCount.textContent = 'Library unavailable'
    sampleList.innerHTML = '<div class="empty-state"><p>Could not load the audio library.</p></div>'
  }
}

searchInput.addEventListener('input', renderSamples)
speakerSelect.addEventListener('change', renderSamples)
durationSelect.addEventListener('change', renderSamples)
categorySelect.addEventListener('change', renderSamples)

testTtsForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  testTtsSubmit.disabled = true
  testTtsSubmit.textContent = 'Generating…'
  testTtsStatus.textContent = 'Requesting Google Cloud Gemini TTS…'
  testTtsResult.hidden = true

  try {
    const response = await fetch('/api/test-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testTtsText.value,
        voice: testTtsVoice.value,
        style: testTtsStyle.value,
      }),
    })
    const payload = await response.json() as {
      url?: string
      model?: string
      languageCode?: string
      voice?: string
      error?: { code: string; message: string }
    }

    if (!response.ok || !payload.url) {
      throw new Error(payload.error?.message ?? 'The server returned an invalid TTS response.')
    }

    testTtsPlayer.src = payload.url
    testTtsPlayer.load()
    testTtsMeta.textContent = `${payload.model} · ${payload.languageCode} · ${payload.voice}`
    testTtsResult.hidden = false
    testTtsStatus.textContent = 'Audio generated.'
  } catch (error) {
    testTtsStatus.textContent = error instanceof Error ? error.message : 'The TTS request failed.'
  } finally {
    testTtsSubmit.disabled = false
    testTtsSubmit.textContent = 'Generate audio'
  }
})

void loadSamples()
