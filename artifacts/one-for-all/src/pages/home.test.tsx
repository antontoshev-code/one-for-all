import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { transcribeAudioMock, setLocationMock } = vi.hoisted(() => ({
  transcribeAudioMock: vi.fn(),
  setLocationMock: vi.fn(),
}));

vi.mock("@/lib/ai-api", () => ({
  transcribeAudio: transcribeAudioMock,
}));

vi.mock("@/lib/analytics", () => ({
  logEvent: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useCreateEntry: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useGetEntryStats: () => ({ data: undefined }),
  getGetEntryStatsQueryKey: () => ["entry-stats"],
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", setLocationMock],
}));

type RecognitionHandlers = {
  onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

let recognitionInstances: FakeSpeechRecognition[] = [];

class FakeSpeechRecognition implements RecognitionHandlers {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: RecognitionHandlers["onresult"] = null;
  onerror: RecognitionHandlers["onerror"] = null;
  onend: RecognitionHandlers["onend"] = null;

  constructor() {
    recognitionInstances.push(this);
  }

  start = vi.fn();

  stop = vi.fn(() => {
    this.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "A native speech transcript" } }],
    });
    this.onend?.();
  });
}

class FakeMediaRecorder {
  readonly mimeType = "audio/webm";
  state: RecordingState = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(readonly stream: MediaStream) {}

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded audio"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function setSpeechRecognition(available: boolean) {
  if (available) {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeSpeechRecognition,
    });
  } else {
    delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  }
}

function setMediaDevices() {
  const stream = {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream;

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
    },
  });

  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder,
  });
}

async function renderHome() {
  vi.resetModules();
  const { default: Home } = await import("./home");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Providers({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  render(<Home />, { wrapper: Providers });
}

async function startAndStopRecording() {
  fireEvent.click(screen.getByRole("button", { name: "Start voice recording" }));
  await screen.findByText("Listening...");
  fireEvent.click(screen.getByRole("button", { name: "Stop voice recording" }));
}

describe("voice recording transcription", () => {
  beforeEach(() => {
    recognitionInstances = [];
    transcribeAudioMock.mockReset();
    setLocationMock.mockReset();
    setMediaDevices();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts a Web Speech transcript in the editable textarea", async () => {
    setSpeechRecognition(true);
    await renderHome();

    await startAndStopRecording();

    expect(await screen.findByDisplayValue("A native speech transcript")).toBeInTheDocument();
    expect(screen.getByText("Real transcript — edit before saving")).toBeInTheDocument();
    expect(recognitionInstances).toHaveLength(1);
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });

  it("uses Whisper when Web Speech is unavailable", async () => {
    setSpeechRecognition(false);
    transcribeAudioMock.mockResolvedValue({
      transcript: "A Whisper fallback transcript",
      source: "whisper",
    });
    await renderHome();

    await startAndStopRecording();

    expect(await screen.findByDisplayValue("A Whisper fallback transcript")).toBeInTheDocument();
    expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Real transcript — edit before saving")).toBeInTheDocument();
  });

  it("asks the user to type when neither transcription path succeeds", async () => {
    setSpeechRecognition(false);
    transcribeAudioMock.mockResolvedValue({
      transcript: "",
      source: "error",
    });
    await renderHome();

    await startAndStopRecording();

    expect(await screen.findByText("Transcription unavailable — please type your note")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("");
    });
    expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
  });
});