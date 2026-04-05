import { useEffect, useState, useRef } from "react";

import Chat from "./components/Chat";
import Progress from "./components/Progress";

// WebGPU detection is async — moved into the component
const STICKY_SCROLL_THRESHOLD = 120;

const MODELS = [
  { id: "onnx-community/gemma-4-E2B-it-ONNX", label: "Gemma 4 E2B — q4f16 (~1.5 GB)", dtype: "q4f16" },
  { id: "onnx-community/gemma-4-E2B-it-ONNX", label: "Gemma 4 E2B — q4 (~1.9 GB)", dtype: "q4" },
];

const EXAMPLES = [
  "Give me tips to improve my time management skills.",
  "Write a poem about machine learning.",
  "Write Python code to compute the nth Fibonacci number.",
];

function App() {
  const worker = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);
  const imageInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Model
  const [selectedModelIdx, setSelectedModelIdx] = useState(0);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [totalProgress, setTotalProgress] = useState(0);

  // IO
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);
  const [thinking, setThinking] = useState(false);

  // Media
  const [attachedImage, setAttachedImage] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [attachedAudio, setAttachedAudio] = useState(null);

  // WebGPU detection
  const [gpuStatus, setGpuStatus] = useState("checking"); // "checking" | "ok" | "no-api" | "no-adapter" | "no-features"
  const [gpuError, setGpuError] = useState("");

  // Cache status
  const [modelCached, setModelCached] = useState(null); // null = checking, true/false

  useEffect(() => {
    (async () => {
      if (!navigator.gpu) {
        setGpuStatus("no-api");
        setGpuError("Seu navegador não suporta WebGPU. Use Chrome 121+ ou Edge 121+.");
        return;
      }
      // Try multiple adapter options
      const adapterOptions = [
        { powerPreference: "high-performance" },
        { powerPreference: "low-power" },
        {},
      ];
      let adapter = null;
      for (const opts of adapterOptions) {
        try {
          adapter = await navigator.gpu.requestAdapter(opts);
          if (adapter) break;
        } catch (_) { /* try next */ }
      }
      if (!adapter) {
        setGpuStatus("no-adapter");
        setGpuError(
          "WebGPU está disponível mas nenhum adaptador GPU foi encontrado. " +
          "No Android, ative a flag chrome://flags/#enable-unsafe-webgpu e reinicie o Chrome."
        );
        return;
      }
      // Verify we can actually get a device
      try {
        const device = await adapter.requestDevice();
        device.destroy();
        setGpuStatus("ok");
      } catch (err) {
        setGpuStatus("no-features");
        setGpuError(`GPU encontrada mas não foi possível inicializar: ${err.message}`);
      }
    })();
  }, []);

  // Check if selected model is cached
  useEffect(() => {
    (async () => {
      setModelCached(null);
      try {
        const cacheNames = await caches.keys();
        const modelId = MODELS[selectedModelIdx].id;
        for (const name of cacheNames) {
          const cache = await caches.open(name);
          const keys = await cache.keys();
          const hasModel = keys.some((req) => req.url.includes(modelId.replace("/", "%2F")) || req.url.includes(modelId));
          if (hasModel) { setModelCached(true); return; }
        }
        setModelCached(false);
      } catch {
        setModelCached(false);
      }
    })();
  }, [selectedModelIdx]);

  function onEnter(message) {
    const userMsg = { role: "user", content: message };
    const images = [];
    const audio = [];

    if (attachedImage) {
      userMsg.image = true;
      userMsg.imageUrl = attachedImage;
      images.push(attachedImage);
    }
    if (attachedAudio) {
      userMsg.audio = true;
      audio.push(attachedAudio);
    }

    setMessages((prev) => [...prev, userMsg]);
    setTps(null);
    setIsRunning(true);
    setInput("");
    setAttachedImage(null);
    setAttachedAudio(null);

    worker.current.postMessage({
      type: "generate",
      data: {
        messages: [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
          image: m.image,
          audio: m.audio,
        })),
        images,
        audio,
      },
    });
  }

  function onInterrupt() {
    worker.current.postMessage({ type: "interrupt" });
  }

  useEffect(() => {
    if (!textareaRef.current) return;
    const target = textareaRef.current;
    target.style.height = "auto";
    target.style.height = `${Math.min(Math.max(target.scrollHeight, 24), 200)}px`;
  }, [input]);

  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ type: "check" });
    }

    const onMessageReceived = (e) => {
      switch (e.data.status) {
        case "loading":
          setStatus("loading");
          setLoadingMessage(e.data.data);
          break;
        case "initiate":
          setProgressItems((prev) => [...prev, e.data]);
          break;
        case "progress":
          setProgressItems((prev) => {
            const updated = prev.map((item) =>
              item.file === e.data.file ? { ...item, ...e.data } : item,
            );
            // Calculate total progress
            const total = updated.reduce((acc, item) => acc + (item.progress || 0), 0);
            const count = updated.length;
            if (count > 0) setTotalProgress(total / count);
            return updated;
          });
          break;
        case "done":
          setProgressItems((prev) =>
            prev.filter((item) => item.file !== e.data.file),
          );
          break;
        case "ready":
          setStatus("ready");
          break;
        case "start":
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "", thinking: "" },
          ]);
          break;
        case "thinking_start":
          break;
        case "thinking_update": {
          const { output, tps, numTokens } = e.data;
          setTps(tps);
          setNumTokens(numTokens);
          setMessages((prev) => {
            const cloned = [...prev];
            cloned[cloned.length - 1] = { ...cloned.at(-1), thinking: output };
            return cloned;
          });
          break;
        }
        case "thinking_end":
          break;
        case "update": {
          const { output, tps, numTokens } = e.data;
          setTps(tps);
          setNumTokens(numTokens);
          setMessages((prev) => {
            const cloned = [...prev];
            const last = cloned.at(-1);
            cloned[cloned.length - 1] = { ...last, content: last.content + output };
            return cloned;
          });
          break;
        }
        case "complete":
          setIsRunning(false);
          break;
        case "error":
          setError(e.data.data);
          break;
      }
    };

    worker.current.addEventListener("message", onMessageReceived);
    return () => worker.current.removeEventListener("message", onMessageReceived);
  }, []);

  useEffect(() => {
    if (!chatContainerRef.current || !isRunning) return;
    const el = chatContainerRef.current;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_SCROLL_THRESHOLD) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isRunning]);

  // --- Media handlers ---
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAttachedImage(reader.result);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const cameraStreamRef = useRef(null);
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      cameraStreamRef.current = stream;
      setCameraActive(true);
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    setAttachedImage(canvas.toDataURL("image/jpeg", 0.8));
    stopCamera();
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    setCameraActive(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const arrayBuf = await blob.arrayBuffer();
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        setAttachedAudio(decoded.getChannelData(0));
        audioCtx.close();
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Mic error:", err);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const isReady = status === "ready";
  const canSend = isReady && !isRunning && (input.length > 0 || attachedImage || attachedAudio);

  if (gpuStatus === "checking") {
    return (
      <div className="fixed inset-0 bg-dm-bg flex items-center justify-center text-center px-6">
        <div>
          <div className="text-4xl mb-4 animate-pulse">🔍</div>
          <p className="text-dm-text-secondary">Verificando compatibilidade da GPU...</p>
        </div>
      </div>
    );
  }

  if (gpuStatus !== "ok") {
    return (
      <div className="fixed inset-0 bg-dm-bg flex items-center justify-center text-center px-6">
        <div className="max-w-md">
          <div className="text-4xl mb-4">:(</div>
          <h1 className="text-2xl font-bold text-dm-text mb-3">WebGPU não disponível</h1>
          <p className="text-dm-text-secondary mb-6">{gpuError}</p>
          {gpuStatus === "no-adapter" && (
            <div className="text-left bg-dm-surface-high rounded-xl p-4 text-sm text-dm-text-secondary space-y-2">
              <p className="font-semibold text-dm-text">Como ativar no Android:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Abra <span className="text-dm-blue font-mono">chrome://flags</span> no Chrome</li>
                <li>Pesquise por <span className="font-semibold text-dm-text">WebGPU</span></li>
                <li>Ative <span className="font-semibold text-dm-text">Unsafe WebGPU</span> e <span className="font-semibold text-dm-text">WebGPU Developer Features</span></li>
                <li>Reinicie o Chrome</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-dm-bg">
      {/* Hidden elements */}
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
      {/* hidden video is no longer needed — video is in the camera overlay */}
      <canvas ref={canvasRef} className="hidden" />

      {/* ====== LANDING ====== */}
      {status === null && messages.length === 0 && (
        <div className="h-full flex flex-col items-center relative overflow-hidden">
          {/* Background */}
          <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(92,184,92,0.15) 0%, rgba(92,184,92,0.05) 40%, transparent 70%)" }} />
          <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 80% 100%, rgba(92,184,92,0.08) 0%, transparent 50%)" }} />

          {/* Header with logo */}
          <div className="relative z-10 w-full flex justify-center py-6 border-b border-dm-outline">
            <img src="/clockin.png" alt="Clockin" className="h-8 object-contain animate-fade-in-up" />
          </div>

          <div className="relative z-10 flex flex-col items-center text-center px-6 flex-1 justify-center">
            <h1 className="text-6xl sm:text-7xl font-bold tracking-tight text-dm-text animate-title-appear animate-glow">
              Private AI
            </h1>
            <p className="mt-4 max-w-lg text-lg text-dm-text-secondary animate-subtitle-appear">
              Multimodal AI running privately in your browser.
              <br />
              Text, images, camera, and audio.
            </p>
            <div className="mt-3 flex items-center gap-2 text-dm-text-secondary animate-subtitle-appear">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
                <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
              <span className="text-sm">No internet required</span>
            </div>

            {/* Model selector */}
            <div className="mt-8 w-full max-w-[300px] animate-subtitle-appear">
              <select
                className="w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-dm-blue/50 cursor-pointer"
                style={{ backgroundColor: "#2f3034", borderColor: "rgba(230,234,240,0.2)", color: "#f8f9fc" }}
                value={selectedModelIdx}
                onChange={(e) => setSelectedModelIdx(Number(e.target.value))}
                disabled={status !== null}
              >
                {MODELS.map((m, i) => (
                  <option key={i} value={i} className="bg-dm-surface-high text-dm-text">{m.label}</option>
                ))}
              </select>
            </div>

            {/* Cache status */}
            <div className="mt-3 text-sm animate-subtitle-appear">
              {modelCached === null ? (
                <span className="text-dm-text-secondary">Checking cache...</span>
              ) : modelCached ? (
                <span className="text-dm-green flex items-center gap-1.5 justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                  Model cached — fast loading
                </span>
              ) : (
                <span className="text-dm-text-secondary flex items-center gap-1.5 justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  First use — model download required
                </span>
              )}
            </div>

            {error && (
              <div className="mt-4 text-dm-red text-sm">{error}</div>
            )}

            <button
              className="mt-6 rounded-full bg-dm-text px-8 py-3 text-base font-semibold text-dm-bg hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed animate-button-appear"
              onClick={() => {
                const model = MODELS[selectedModelIdx];
                worker.current.postMessage({ type: "load", data: { model_id: model.id, dtype: model.dtype } });
                setStatus("loading");
              }}
              disabled={status !== null || error !== null}
            >
              {modelCached ? "Start" : "Download & Start"}
            </button>
          </div>
        </div>
      )}

      {/* ====== LOADING ====== */}
      {status === "loading" && (
        <div className="h-full flex flex-col items-center justify-center gap-8 px-6 animate-fade-in-up">
          <h2 className="text-3xl font-bold tracking-tight text-dm-text">Private AI</h2>

          <div className="w-full max-w-[400px] space-y-1">
            <div className="text-2xl font-semibold tabular-nums text-dm-text text-center mb-4">
              {totalProgress.toFixed(0)}%
            </div>
            {progressItems.map(({ file, progress, total }, i) => (
              <Progress key={i} text={file} percentage={progress} total={total} />
            ))}
          </div>

          <p className="text-xs text-dm-text-secondary absolute bottom-8">{loadingMessage}</p>
        </div>
      )}

      {/* ====== CHAT ====== */}
      {status === "ready" && (
        <div
          ref={chatContainerRef}
          className="overflow-y-auto scrollbar-thin w-full flex flex-col items-center flex-1"
        >
          <Chat messages={messages} />
          {messages.length === 0 && (
            <div className="flex flex-col gap-2 mb-4">
              {EXAMPLES.map((msg, i) => (
                <button
                  key={i}
                  className="frosted rounded-xl px-4 py-2.5 text-sm text-dm-text-secondary hover:text-dm-text hover:bg-dm-surface-higher/50 transition-colors text-left"
                  onClick={() => onEnter(msg)}
                >
                  {msg}
                </button>
              ))}
            </div>
          )}

          {/* Stats */}
          <div className="text-center text-xs min-h-6 text-dm-text-secondary tabular-nums mb-2">
            {tps && messages.length > 0 && (
              <>
                {!isRunning && (
                  <span>
                    {numTokens} tokens in {(numTokens / tps).toFixed(2)}s ·{" "}
                  </span>
                )}
                <span className="font-medium text-dm-text">{tps.toFixed(1)}</span> tok/s
                {!isRunning && (
                  <>
                    {" · "}
                    <button
                      className="text-dm-blue hover:underline"
                      onClick={() => {
                        worker.current.postMessage({ type: "reset" });
                        setMessages([]);
                      }}
                    >
                      Reset
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ====== CAMERA OVERLAY ====== */}
      {cameraActive && (
        <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center gap-6">
          {/* Video + viewfinder corners */}
          <div className="relative">
            <video ref={(el) => { videoRef.current = el; if (el && cameraStreamRef.current) { el.srcObject = cameraStreamRef.current; el.play(); } }} className="max-w-[90vw] max-h-[60vh] rounded-2xl" autoPlay playsInline />
            <div className="absolute -top-2 -left-2 w-8 h-8 border-t-2 border-l-2 border-dm-blue rounded-tl-lg animate-pulse" />
            <div className="absolute -top-2 -right-2 w-8 h-8 border-t-2 border-r-2 border-dm-blue rounded-tr-lg animate-pulse" />
            <div className="absolute -bottom-2 -left-2 w-8 h-8 border-b-2 border-l-2 border-dm-blue rounded-bl-lg animate-pulse" />
            <div className="absolute -bottom-2 -right-2 w-8 h-8 border-b-2 border-r-2 border-dm-blue rounded-br-lg animate-pulse" />
          </div>
          <div className="flex gap-3">
            <button className="size-14 rounded-full bg-dm-text flex items-center justify-center active:scale-95 transition-transform" onClick={captureFrame}>
              <div className="size-12 rounded-full border-2 border-dm-bg" />
            </button>
            <button className="size-14 rounded-full bg-dm-surface-higher flex items-center justify-center text-dm-red active:scale-95 transition-transform" onClick={stopCamera}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ====== ATTACHMENT PREVIEW ====== */}
      {(attachedImage || attachedAudio) && (
        <div className="flex items-center gap-2 justify-center py-2">
          {attachedImage && (
            <div className="relative group">
              <img src={attachedImage} className="h-16 rounded-xl border border-dm-outline" alt="preview" />
              <button
                className="absolute -top-1.5 -right-1.5 bg-dm-red text-white rounded-full size-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setAttachedImage(null)}
              >
                x
              </button>
            </div>
          )}
          {attachedAudio && (
            <div className="relative group frosted rounded-xl px-3 py-2 text-xs text-dm-text-secondary">
              Audio ({(attachedAudio.length / 16000).toFixed(1)}s)
              <button
                className="absolute -top-1.5 -right-1.5 bg-dm-red text-white rounded-full size-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setAttachedAudio(null)}
              >
                x
              </button>
            </div>
          )}
        </div>
      )}

      {/* ====== CONTROLS + INPUT ====== */}
      {status === "ready" && (
        <div className="px-4 pb-4 pt-1 flex flex-col items-center gap-2">
          {/* Thinking toggle */}
          <button
            className={`text-xs px-3 py-1 rounded-full border transition-all ${
              thinking
                ? "bg-dm-blue/20 text-dm-blue border-dm-blue/40"
                : "text-dm-text-secondary border-dm-outline hover:border-dm-text-secondary/30"
            }`}
            onClick={() => {
              setThinking(!thinking);
              worker.current?.postMessage({ type: "set_thinking", data: !thinking });
            }}
          >
            {thinking ? "Thinking ON" : "Thinking OFF"}
          </button>

          {/* Input bar */}
          <div className="frosted rounded-full w-full max-w-[650px] flex items-end px-2 py-1.5">
            {/* Media buttons */}
            <div className="flex items-center gap-0.5 pb-1 pl-1">
              <button
                className="size-10 rounded-xl flex items-center justify-center text-dm-text-secondary hover:text-dm-text hover:bg-dm-surface-higher/50 transition-colors disabled:opacity-30"
                onClick={() => imageInputRef.current?.click()}
                disabled={!isReady || isRunning}
                title="Upload image"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              </button>
              <button
                className="size-10 rounded-xl flex items-center justify-center text-dm-text-secondary hover:text-dm-text hover:bg-dm-surface-higher/50 transition-colors disabled:opacity-30"
                onClick={startCamera}
                disabled={!isReady || isRunning}
                title="Camera"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </button>
              <button
                className={`size-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-30 ${
                  isRecording
                    ? "bg-dm-red text-white animate-pulse-ring"
                    : "text-dm-text-secondary hover:text-dm-text hover:bg-dm-surface-higher/50"
                }`}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={!isReady || isRunning}
                title={isRecording ? "Stop recording" : "Record audio"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            </div>

            <textarea
              ref={textareaRef}
              className="flex-1 bg-transparent px-3 py-2.5 text-sm text-dm-text placeholder-dm-text-secondary/50 outline-none resize-none disabled:cursor-not-allowed overflow-hidden"
              placeholder={attachedImage || attachedAudio ? "Ask about the attachment..." : "Ask anything..."}
              rows={1}
              value={input}
              disabled={!isReady}
              onKeyDown={(e) => {
                if (canSend && e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onEnter(input || "Describe this.");
                }
              }}
              onInput={(e) => setInput(e.target.value)}
            />

            {/* Send / Stop */}
            {isRunning ? (
              <button
                className="size-10 rounded-xl flex items-center justify-center text-dm-text-secondary hover:text-dm-text hover:bg-dm-surface-higher/50 transition-colors mb-1 mr-1"
                onClick={onInterrupt}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                className={`size-10 rounded-xl flex items-center justify-center mb-1 mr-1 transition-all ${
                  canSend
                    ? "bg-dm-text text-dm-bg hover:opacity-90 active:scale-95"
                    : "text-dm-text-secondary/30"
                }`}
                onClick={() => canSend && onEnter(input || "Describe this.")}
                disabled={!canSend}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>

          <p className="text-[10px] text-dm-text-secondary/40">
            Generated content may be inaccurate or false.
          </p>
        </div>
      )}
    </div>
  );
}

export default App;
