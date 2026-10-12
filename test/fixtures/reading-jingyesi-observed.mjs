// Reconstructed from the user's 13-row screenshot. NOT a raw Deepgram capture.
export const provenance = {
  source: 'User screenshot; ordered text and Partial/Final labels transcribed manually',
  corroboration: 'V4 server/.local/logs/server-2026-10-11_16-49-20.log lines 395, 409, 423, 432 contain matching final aggregated text',
  missing: ['raw Deepgram results', 'provider audio ranges', 'Reading segment IDs', 'original epoch', 'original event timestamps'],
  assumptions: 'One synthetic segment per displayed Final; epoch=0; seq follows screenshot; 400ms synthetic spacing. VAD IDs are not used as Provider IDs.',
};
export const reference = '床前明月光，疑是地上霜。举头望明月，低头思故乡。';
const groups = [
  ['床', '床前名', '床前明月光', '床前明月光'],
  ['一室', '一室地上霜', '一世地上霜。'],
  ['举', '举头望名', '举头望明月'],
  ['低头', '低头思故', '低头思苦香'],
];
let seq = 0;
export const events = groups.flatMap((texts, segment) => texts.map((text, i) => ({
  type: 'stt', epoch: 0, seq: ++seq, segment: `reconstructed-${segment + 1}`,
  at: seq * 400, text, final: i === texts.length - 1,
})));
