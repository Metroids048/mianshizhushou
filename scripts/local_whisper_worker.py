"""Line-oriented PCM16 worker for the optional local Whisper ASR provider."""

import argparse
import base64
import json
import sys


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="base")
    parser.add_argument("--download-root", required=True)
    parser.add_argument("--warmup", action="store_true")
    args = parser.parse_args()

    try:
        import numpy as np
        from faster_whisper import WhisperModel
    except ImportError as error:
        emit({"type": "error", "message": f"缺少本地 Whisper 依赖：{error}"})
        raise SystemExit(2)

    model = WhisperModel(args.model, device="cpu", compute_type="int8", download_root=args.download_root)
    if args.warmup:
        emit({"type": "ready", "model": args.model})
        return
    emit({"type": "ready", "model": args.model})
    for line in sys.stdin:
        try:
            request = json.loads(line)
            pcm = base64.b64decode(request["pcm16Base64"])
            audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
            segments, _ = model.transcribe(
                audio,
                language="zh",
                beam_size=1,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            text = "".join(segment.text for segment in segments).strip()
            emit({"type": "result", "id": request.get("id"), "text": text})
        except Exception as error:  # Worker errors are sent over stdout for the Node relay.
            emit({"type": "error", "message": str(error)})


if __name__ == "__main__":
    main()
