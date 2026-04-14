import {
  AutoProcessor,
  AutoModelForImageTextToText,
  TextStreamer,
  InterruptableStoppingCriteria,
  RawImage,
} from "@huggingface/transformers";

class TextGenerationPipeline {
  static model_id = null;
  static dtype = "q4f16";

  static async getInstance(progress_callback = null) {
    this.processor ??= AutoProcessor.from_pretrained(this.model_id, {
      progress_callback,
    });

    this.model ??= AutoModelForImageTextToText.from_pretrained(this.model_id, {
      dtype: this.dtype,
      device: "webgpu",
      use_external_data_format: true,
      progress_callback,
    });

    return Promise.all([this.processor, this.model]);
  }
}

const stopping_criteria = new InterruptableStoppingCriteria();
let enableThinking = false;

async function generate({ messages, images, audio }) {
  try {
    const [processor, model] = await TextGenerationPipeline.getInstance();

    const formattedMessages = messages.map((msg) => {
      if (msg.role === "user" && (msg.image || msg.audio)) {
        const content = [];
        if (msg.image) content.push({ type: "image" });
        if (msg.audio) content.push({ type: "audio" });
        content.push({ type: "text", text: msg.content || "Describe this." });
        return { role: "user", content };
      }
      return msg;
    });

    const text = processor.tokenizer.apply_chat_template(formattedMessages, {
      add_generation_prompt: true,
      tokenize: false,
      enable_thinking: enableThinking,
    });

    let loadedImages = null;
    if (images && images.length > 0) {
      loadedImages = await Promise.all(
        images.map((img) => RawImage.fromURL(img))
      );
    }

    let loadedAudio = null;
    if (audio && audio.length > 0) {
      loadedAudio = audio;
    }

    const inputs = await processor(text, loadedImages, loadedAudio);

    let startTime;
    let numTokens = 0;
    let tps;
    let fullOutput = "";
    let inThinking = false;

    const token_callback_function = () => {
      startTime ??= performance.now();
      if (numTokens++ > 0) {
        tps = (numTokens / (performance.now() - startTime)) * 1000;
      }
    };

    const callback_function = (output) => {
      fullOutput += output;

      if (enableThinking) {
        if (fullOutput.includes("<|channel>thought\n") && !fullOutput.includes("<channel|>")) {
          if (!inThinking) {
            inThinking = true;
            self.postMessage({ status: "thinking_start" });
          }
          const thinkStart = fullOutput.indexOf("<|channel>thought\n") + "<|channel>thought\n".length;
          const thinkText = fullOutput.slice(thinkStart);
          self.postMessage({ status: "thinking_update", output: thinkText, tps, numTokens });
          return;
        }
        if (inThinking && fullOutput.includes("<channel|>")) {
          inThinking = false;
          self.postMessage({ status: "thinking_end" });
          const afterThink = fullOutput.slice(fullOutput.indexOf("<channel|>") + "<channel|>".length);
          self.postMessage({ status: "update", output: afterThink, tps, numTokens });
          return;
        }
      }

      self.postMessage({ status: "update", output, tps, numTokens });
    };

    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function,
      token_callback_function,
    });

    self.postMessage({ status: "start" });

    await model.generate({
      ...inputs,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      max_new_tokens: 2048,
      streamer,
      stopping_criteria,
      return_dict_in_generate: true,
    });

    self.postMessage({ status: "complete" });
  } catch (e) {
    const msg = e.toString();
    let detail;
    if (msg.includes("out of memory") || msg.includes("OOM") || msg.includes("allocation")) {
      detail = "Memória GPU insuficiente. Tente fechar outras abas e reiniciar o navegador.";
    } else if (msg.includes("device lost") || msg.includes("Device lost")) {
      detail = "GPU desconectada — o sistema pode ter encerrado o processo por uso de memória. Reinicie o navegador.";
    } else if (msg.includes("shader") || msg.includes("compilation")) {
      detail = "Erro na compilação de shaders WebGPU. Verifique se o Chrome está atualizado.";
    } else {
      detail = msg;
    }
    self.postMessage({ status: "error", data: detail });
  }
}

async function check() {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("WebGPU is not supported (no adapter found)");
  } catch (e) {
    self.postMessage({ status: "error", data: e.toString() });
  }
}

async function load({ model_id, dtype } = {}) {
  try {
    TextGenerationPipeline.model_id = model_id || "onnx-community/gemma-4-E2B-it-ONNX";
    TextGenerationPipeline.dtype = dtype || "q4f16";
    self.postMessage({ status: "loading", data: `Loading ${TextGenerationPipeline.model_id} (this may take a few minutes on first visit)...` });

    const [processor, model] = await TextGenerationPipeline.getInstance((x) => {
      self.postMessage(x);
    });

    self.postMessage({ status: "loading", data: "Compiling shaders and warming up model..." });

    // Warmup: use the processor to tokenize a simple text prompt
    const warmupText = processor.tokenizer.apply_chat_template(
      [{ role: "user", content: "hi" }],
      { add_generation_prompt: true, tokenize: false },
    );
    const inputs = await processor(warmupText);
    await model.generate({ ...inputs, max_new_tokens: 1 });
    self.postMessage({ status: "ready" });
  } catch (e) {
    const msg = e.toString();
    let detail;
    if (msg.includes("out of memory") || msg.includes("OOM") || msg.includes("allocation")) {
      detail = "Memória GPU insuficiente para carregar o modelo. Tente fechar outras abas e apps.";
    } else if (msg.includes("device lost") || msg.includes("Device lost")) {
      detail = "GPU desconectada durante o carregamento. Reinicie o navegador e tente novamente.";
    } else if (msg.includes("shader") || msg.includes("compilation")) {
      detail = "Erro na compilação de shaders. Verifique se o Chrome está atualizado (121+).";
    } else if (msg.includes("NetworkError") || msg.includes("Failed to fetch") || msg.includes("AbortError")) {
      detail = "Erro de rede durante o download. Verifique sua conexão e tente novamente.";
    } else if (msg.includes("QuotaExceededError") || msg.includes("quota")) {
      detail = "Armazenamento insuficiente no dispositivo. Libere espaço e tente novamente.";
    } else {
      detail = msg;
    }
    self.postMessage({ status: "error", data: detail });
  }
}

self.addEventListener("message", async (e) => {
  const { type, data } = e.data;

  switch (type) {
    case "check":
      check();
      break;
    case "load":
      load(data);
      break;
    case "generate":
      stopping_criteria.reset();
      generate(data);
      break;
    case "interrupt":
      stopping_criteria.interrupt();
      break;
    case "reset":
      stopping_criteria.reset();
      break;
    case "set_thinking":
      enableThinking = data;
      break;
  }
});
