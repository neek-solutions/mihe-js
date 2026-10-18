/**
 * Microphone capture and speaker playback for voice sessions.
 *
 * One format everywhere: **16-bit PCM, 24 kHz, mono, little endian**, matching
 * the voice socket and the provider behind it. Nothing on this path transcodes,
 * which is the point — a resampler in a latency-critical loop buys nothing when
 * every participant already agrees on the rate.
 *
 * Two browser realities shape the code:
 *
 * - **iOS Safari will not start audio without a user gesture.** Push-to-talk
 *   makes that free: the button press *is* the gesture. `resume()` is called on
 *   press rather than at construction for exactly this reason, and calling it
 *   from anywhere else will produce a context stuck in `suspended` with no
 *   error.
 * - **`AudioContext` may refuse the sample rate we ask for.** Chrome, Firefox,
 *   and current Safari honour it; older Safari does not. So capture resamples
 *   when it has to rather than assuming, and playback hands the browser a
 *   buffer tagged 24 kHz and lets the graph resample it.
 */

import { VOICE_SAMPLE_RATE } from "@mihe-dev/protocol";

/**
 * Frames sent up per second. 50 works out to 20 ms per frame — small enough
 * that the end of an utterance is not padded by a buffer waiting to fill, and
 * large enough that the socket is not doing a send per millisecond.
 */
const FRAME_MS = 20;

/**
 * Playback runs this far ahead of the speaker.
 *
 * Without it every chunk that arrives a few milliseconds late produces an
 * audible click as the graph runs dry between buffers. With it, network jitter
 * up to this much is inaudible, at the cost of the same delay before the first
 * word. 200 ms is well under the threshold where a reply feels slow.
 */
const JITTER_BUFFER_MS = 200;

/** The AudioWorklet processor, injected as a Blob so the package ships one file. */
const CAPTURE_WORKLET = `
class MiheCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // A render quantum is 128 samples — about 5 ms at 24 kHz — so posting one
    // per call means roughly 190 messages a second, each becoming its own
    // WebSocket frame and its own JSON envelope upstream. Under push-to-talk
    // that was merely wasteful; with the microphone open continuously it
    // saturated the relay and audio started being dropped, which reads to the
    // user as the assistant simply not answering.
    // Defaulted rather than assumed. An absent option would make \`target\`
    // undefined, every arithmetic result NaN, and the fill loop exit without
    // ever posting — total silence, no error, and nothing in any log to say
    // the microphone had stopped working.
    this.target = options?.processorOptions?.frameSamples || 480;
    this.buffer = new Float32Array(this.target);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // No input yet, or the track ended. Keep the node alive either way:
    // returning false here permanently removes it from the graph, and the
    // user is only between utterances.
    if (!channel) return true;

    let offset = 0;
    while (offset < channel.length) {
      const take = Math.min(this.target - this.filled, channel.length - offset);
      this.buffer.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;

      if (this.filled === this.target) {
        this.port.postMessage(this.buffer.slice());
        this.filled = 0;
      }
    }

    return true;
  }
}
registerProcessor('mihe-capture', MiheCapture);
`;

/** Float samples in [-1, 1] to little-endian 16-bit PCM. */
export function toPcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    // Clamped before scaling: a sample above 1 would wrap to a large negative
    // number, which is heard as a loud click rather than as clipping.
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, clamped * 0x7fff, true);
  }
  return buffer;
}

/** Little-endian 16-bit PCM back to float samples. */
export function fromPcm16(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const samples = new Float32Array(buffer.byteLength / 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x7fff;
  }
  return samples;
}

/**
 * How loud a chunk of speech is, from 0 (silence) to 1 (as loud as speech gets).
 *
 * RMS rather than peak, because a peak jumps on every consonant and a ring
 * drawn from it flickers instead of breathing. Scaled by eye: ordinary speech
 * into a laptop microphone sits around 0.05 to 0.15 RMS, so a square root and
 * a gain put a normal voice in the middle of the range rather than at its foot.
 */
export function pcmLevel(pcm: ArrayBuffer): number {
  const samples = fromPcm16(pcm);
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, Math.sqrt(rms) * 1.8);
}

/**
 * Linear resample, used only when the browser refused our sample rate.
 *
 * Linear rather than anything better on purpose: the input is a voice at
 * 44.1 or 48 kHz going to 24 kHz, the output is fed to a speech model rather
 * than to a listener, and a windowed-sinc filter would cost more than it could
 * possibly be worth here. When the rates already match this is not called at
 * all.
 */
export function resample(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return samples;

  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, samples.length - 1);
    const fraction = position - index;
    out[i] = (samples[index] ?? 0) * (1 - fraction) + (samples[next] ?? 0) * fraction;
  }
  return out;
}

/**
 * The microphone, as a stream of PCM frames.
 *
 * Capture runs continuously once started and is *gated* rather than stopped
 * between utterances: `getUserMedia` takes hundreds of milliseconds and shows a
 * permission prompt the first time, so tearing it down on every button release
 * would clip the beginning of the next sentence — which is exactly where the
 * word the model needs most usually is.
 */
export class MicrophoneCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private open = false;

  constructor(private readonly onFrame: (pcm: ArrayBuffer) => void) {}

  /** True while frames are being delivered. */
  get capturing(): boolean {
    return this.open;
  }

  /**
   * Ask for the microphone and build the graph. Must be called from a user
   * gesture on iOS Safari.
   */
  async start(): Promise<void> {
    if (this.context) {
      await this.context.resume();
      return;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // All three on: the assistant's own voice comes out of the same device
        // in a hands-free session, and without cancellation the model hears
        // itself and answers its own last sentence.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
    this.context = context;
    this.source = context.createMediaStreamSource(this.stream);

    const deliver = (samples: Float32Array) => {
      if (!this.open) return;
      this.onFrame(
        toPcm16(resample(samples, context.sampleRate, VOICE_SAMPLE_RATE)),
      );
    };

    try {
      const url = URL.createObjectURL(
        new Blob([CAPTURE_WORKLET], { type: "application/javascript" }),
      );
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const worklet = new AudioWorkletNode(context, "mihe-capture", {
        processorOptions: {
          // Measured in the context's own samples: the resample to 24 kHz
          // happens after this, on the main thread.
          frameSamples: Math.round((context.sampleRate * FRAME_MS) / 1000),
        },
      });
      worklet.port.onmessage = (event) =>
        deliver(event.data as Float32Array);
      this.source.connect(worklet);
      // Worklets are not pulled unless something downstream asks for their
      // output. A zero-gain node is the standard way to run the graph without
      // routing the microphone to the speaker.
      const sink = context.createGain();
      sink.gain.value = 0;
      worklet.connect(sink).connect(context.destination);
      this.node = worklet;
    } catch {
      // Older Safari, and any browser that blocks Blob worklet modules under a
      // strict CSP. Deprecated but universally present, and it runs on the
      // main thread, which for one mono voice track is fine.
      const frames = Math.max(
        256,
        2 ** Math.round(Math.log2((context.sampleRate * FRAME_MS) / 1000)),
      );
      const processor = context.createScriptProcessor(frames, 1, 1);
      processor.onaudioprocess = (event) =>
        deliver(new Float32Array(event.inputBuffer.getChannelData(0)));
      this.source.connect(processor);
      processor.connect(context.destination);
      this.node = processor;
    }

    await context.resume();
  }

  /** Begin delivering frames. */
  unmute(): void {
    this.open = true;
  }

  /** Stop delivering frames, without releasing the microphone. */
  mute(): void {
    this.open = false;
  }

  /** Release the device and tear down the graph. */
  async stop(): Promise<void> {
    this.open = false;
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close().catch(() => undefined);
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }
}

/**
 * The assistant's voice, as a queue of scheduled buffers.
 *
 * Chunks are scheduled back to back against the audio clock rather than played
 * on arrival, because `AudioBufferSourceNode.start()` with no time argument
 * plays *now* — and forty of those a second produce overlapping speech. The
 * running `nextStart` cursor is what turns a stream of chunks into continuous
 * audio.
 */
export class SpeakerQueue {
  /**
   * Called with each chunk's level at the moment it starts playing, not when
   * it arrives. The provider streams seconds ahead of the speaker, so a level
   * taken on arrival would animate words the user has not heard yet.
   */
  constructor(private readonly onLevel?: (level: number) => void) {}

  private levelTimers = new Set<ReturnType<typeof setTimeout>>();
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  /** Audio-clock time the next chunk should begin at. */
  private nextStart = 0;
  /** Audio-clock time the current run of speech began. */
  private startedAt = 0;

  /** Must be called from a user gesture on iOS Safari. */
  async start(): Promise<void> {
    if (this.context) {
      await this.context.resume();
      return;
    }
    const context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
    this.gain = context.createGain();
    this.gain.connect(context.destination);
    this.context = context;
    await context.resume();
  }

  /** Queue a chunk of assistant speech. */
  enqueue(pcm: ArrayBuffer): void {
    const context = this.context;
    if (!context || !this.gain) return;

    const samples = fromPcm16(pcm);
    if (samples.length === 0) return;

    // Tagged 24 kHz regardless of the context's own rate, so a browser that
    // refused our request resamples on playback instead of playing the
    // assistant at the wrong pitch.
    const buffer = context.createBuffer(1, samples.length, VOICE_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);

    const now = context.currentTime;
    if (this.nextStart < now) {
      // Either the first chunk of an utterance or a gap the network opened up.
      // Restarting the cursor ahead of `now` is what the jitter buffer is:
      // scheduling at `now` exactly means anything arriving late is already
      // too late.
      this.nextStart = now + JITTER_BUFFER_MS / 1000;
      this.startedAt = this.nextStart;
    }

    source.start(this.nextStart);

    if (this.onLevel) {
      const level = pcmLevel(pcm);
      const report = this.onLevel;
      const timer = setTimeout(
        () => {
          this.levelTimers.delete(timer);
          report(level);
        },
        Math.max(0, (this.nextStart - now) * 1000),
      );
      this.levelTimers.add(timer);
    }

    this.nextStart += buffer.duration;

    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  /**
   * How much of the current utterance the user has actually heard, in
   * milliseconds.
   *
   * This is the number the runtime needs to truncate the model's history on a
   * barge-in, and it is not the same as how much has been *received*: the
   * provider streams several seconds ahead of the speaker, so trusting bytes
   * delivered would tell the model the user heard a sentence they were
   * interrupted three words into.
   */
  heardMs(): number {
    if (!this.context || this.startedAt === 0) return 0;
    const heard = this.context.currentTime - this.startedAt;
    return Math.max(0, Math.round(heard * 1000));
  }

  /** True while anything is scheduled or playing. */
  get speaking(): boolean {
    return this.sources.size > 0;
  }

  /** Drop everything queued — an interruption, or the end of a session. */
  flush(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already ended. `stop()` on a finished node throws in some browsers.
      }
    }
    this.sources.clear();
    this.nextStart = 0;
    this.startedAt = 0;

    // Levels for audio that will now never play, and a last zero so a ring
    // following them settles instead of freezing mid-word.
    for (const timer of this.levelTimers) clearTimeout(timer);
    this.levelTimers.clear();
    this.onLevel?.(0);
  }

  async stop(): Promise<void> {
    this.flush();
    this.gain?.disconnect();
    await this.context?.close().catch(() => undefined);
    this.gain = null;
    this.context = null;
  }
}
